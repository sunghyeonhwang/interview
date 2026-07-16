import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import { extractJSON, geminiSearch } from "@/lib/ai";

export const maxDuration = 300;

type Params = { params: Promise<{ sessionId: string }> };

interface FoundRef {
  brand_name: string;
  url: string;
  summary: string;
}

// 대상 페이지의 og:image 스크랩 (5초 타임아웃), 실패 시 Google favicon 폴백
async function resolveImage(url: string): Promise<string> {
  const fallback = () => {
    try {
      const host = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${host}&sz=256`;
    } catch {
      return "";
    }
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GriffBot/1.0)" },
    });
    clearTimeout(timer);
    if (!res.ok) return fallback();
    const html = (await res.text()).slice(0, 200_000);
    const og =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
    if (og) return new URL(og, url).href;
    return fallback();
  } catch {
    return fallback();
  }
}

// Behance 직접 검색: 서버 렌더링된 검색 페이지를 파싱 (Playwright·API키 불필요)
async function behanceSearch(query: string): Promise<(FoundRef & { image_url: string })[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://www.behance.net/search/projects?search=${encodeURIComponent(query)}`,
      {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      }
    );
    if (!res.ok) return [];
    const html = await res.text();
    const links = [...html.matchAll(/href="(\/gallery\/(\d+)\/[^"?]+)[^"]*"[^>]*title="Link to project - ([^"]+)"/g)];
    const images = [...new Set([...html.matchAll(/(https:\/\/mir-s3-cdn-cf\.behance\.net\/projects\/[^")\s]+)/g)].map((m) => m[1]))];
    const seen = new Set<string>();
    const out: (FoundRef & { image_url: string })[] = [];
    for (const [, path, pid, title] of links) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      // 이미지 파일명에 프로젝트 ID 포함 — 고해상 변형(max_808) 우선
      const candidates = images.filter((u) => u.includes(pid));
      const image = candidates.find((u) => u.includes("max_808")) ?? candidates[0] ?? "";
      out.push({
        brand_name: title.replace(/&amp;/g, "&").replace(/&#39;/g, "'"),
        url: `https://www.behance.net${path}`,
        summary: `Behance 프로젝트 — 검색어: ${query}`,
        image_url: image,
      });
      if (out.length >= 12) break;
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// 방향별 레퍼런스(벤치마크) 서치 — source: "claude"(AI 웹서치) | "behance"(직접 파싱)
export async function POST(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { sessionId } = await params;
  const { direction, query, source } = await req.json().catch(() => ({}));
  if (!direction && !query) {
    return NextResponse.json({ error: "direction 또는 query가 필요합니다." }, { status: 400 });
  }
  const client = db();

  const { data: brief } = await client
    .from("iv_briefs")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (!brief) return NextResponse.json({ error: "브리프를 먼저 생성하세요." }, { status: 400 });

  const directions = (brief.content?.directions ?? []) as {
    name: string;
    concept: string;
    search_queries: string[];
  }[];
  const dir = directions.find((d) => d.name === direction);
  const queries: string[] = query ? [query] : (dir?.search_queries ?? []);
  if (!queries.length) return NextResponse.json({ error: "검색 쿼리가 없습니다." }, { status: 400 });

  // ── Behance 직접 검색 경로 (Claude 불필요) ──
  if (source === "behance") {
    const results = (await Promise.all(queries.slice(0, 2).map(behanceSearch))).flat();
    const seen = new Set<string>();
    const rows = results
      .filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)))
      .map((r) => ({
        brief_id: brief.id,
        direction: direction ?? "custom",
        brand_name: r.brand_name,
        url: r.url,
        summary: r.summary,
        image_url: (r as { image_url?: string }).image_url ?? "",
      }));
    if (!rows.length) return NextResponse.json({ references: [] });
    const { data, error } = await client.from("iv_references").insert(rows).select();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ references: data });
  }

  // Google Search grounding (Gemini) — Claude web_search 대비 응답이 수 초로 빠름
  const text = await geminiSearch(
    `너는 브랜드 디자인 리서처다. Google 검색으로 실제 브랜드/로고 리디자인 벤치마크 사례를 찾는다.
규칙:
- 반드시 실존하는 브랜드·프로젝트만 수집한다. 각 항목의 url은 실제로 방문 가능한 사례 페이지여야 한다.
- Behance, BP&O(bpando.org), Brand New(underconsideration.com), 디자인 어워드(Good Design Award, Red Dot, iF) 등 큐레이션된 출처를 우선한다.
- Pinterest 결과는 절대 포함하지 않는다.
- summary는 한국어 한 문장: 어떤 브랜드이고 시각적으로 어떤 특징이 있는지.
- 5~8개를 수집하고, 다른 설명 없이 아래 형식의 JSON 코드 블록만 출력한다:
\`\`\`json
{"references": [{"brand_name": "...", "url": "...", "summary": "..."}]}
\`\`\``,
    `다음 방향의 벤치마크 사례를 웹에서 검색해라.
방향: ${dir ? `${dir.name} — ${dir.concept}` : "(사용자 지정 검색)"}
검색 쿼리 후보:\n${queries.map((q) => `- ${q}`).join("\n")}`
  );

  let found: FoundRef[];
  try {
    found = extractJSON<{ references: FoundRef[] }>(text).references ?? [];
  } catch {
    return NextResponse.json({ error: "검색 결과 파싱에 실패했습니다. 다시 시도해주세요." }, { status: 502 });
  }

  // Pinterest 이중 차단 + 이미지 해석 (병렬)
  const cleaned = found.filter((r) => r.url && !/pinterest|pin\.it/i.test(r.url));
  const withImages = await Promise.all(
    cleaned.map(async (r) => ({
      brief_id: brief.id,
      direction: direction ?? "custom",
      brand_name: r.brand_name,
      url: r.url,
      summary: r.summary,
      image_url: await resolveImage(r.url),
    }))
  );

  if (!withImages.length) return NextResponse.json({ references: [] });
  const { data, error } = await client.from("iv_references").insert(withImages).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ references: data });
}
