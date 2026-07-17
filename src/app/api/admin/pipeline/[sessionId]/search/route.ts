import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import { ownerFilter } from "@/lib/pipeline";
import { extractJSON, geminiSearch } from "@/lib/ai";

export const maxDuration = 300;

type Params = { params: Promise<{ sessionId: string }> };

interface FoundRef {
  brand_name: string;
  url: string;
  summary: string;
}

// 브라우저급 요청 헤더 — 봇 UA 차단 사이트(Behance, Brand New 등) 대응
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
};

async function fetchText(url: string, ms: number, headers: Record<string, string>): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    if (!res.ok) throw new Error(String(res.status));
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function extractOg(html: string, baseUrl: string): string {
  const og =
    html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ??
    html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
  try {
    return og ? new URL(og, baseUrl).href : "";
  } catch {
    return "";
  }
}

function faviconFor(url: string): string {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=256`;
  } catch {
    return "";
  }
}

// URL 생존 검증 + og:image 해석.
// 반환: og 이미지 URL | favicon(살아있지만 이미지 추출 실패) | null(404 등 죽은 링크 — 레퍼런스에서 제외)
async function verifyAndResolve(url: string): Promise<string | null> {
  // 1) 직접 접근 (브라우저급 헤더)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    const res = await fetch(url, { signal: controller.signal, headers: BROWSER_HEADERS, redirect: "follow" });
    clearTimeout(timer);
    if ([404, 410].includes(res.status)) return null; // AI가 지어낸 죽은 링크
    if (res.ok) {
      const og = extractOg((await res.text()).slice(0, 300_000), url);
      return og || faviconFor(url);
    }
    // 403/429 등 봇 차단 의심 → Jina 경유로 재시도
  } catch {
    /* 네트워크 실패 → Jina 시도 */
  }
  // 2) Jina Reader 경유 (데이터센터 IP·봇 차단 사이트 대응, API 키 불필요)
  try {
    const html = await fetchText(`https://r.jina.ai/${url}`, 12_000, { "X-Return-Format": "html" });
    const og = extractOg(html.slice(0, 300_000), url);
    return og || faviconFor(url);
  } catch (e) {
    // Jina가 대상 404를 그대로 보고하면 죽은 링크로 판정
    if (/\b40[34]\b|not found/i.test(String(e))) return null;
    return faviconFor(url);
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
    .or(ownerFilter(sessionId))
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
- url은 검색 결과에서 직접 확인한 것만 쓴다. 기억으로 URL 슬러그를 재구성·추측하는 것은 금지. 확실한 url이 없는 항목은 제외한다.
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

  // Pinterest 이중 차단 + URL 생존 검증 + 이미지 해석 (병렬) — 죽은 링크(404)는 제외
  const cleaned = found.filter((r) => r.url && !/pinterest|pin\.it/i.test(r.url));
  const withImages = (
    await Promise.all(
      cleaned.map(async (r) => {
        const image = await verifyAndResolve(r.url);
        if (image === null) return null; // 404 — AI가 지어낸 링크
        return {
          brief_id: brief.id,
          direction: direction ?? "custom",
          brand_name: r.brand_name,
          url: r.url,
          summary: r.summary,
          image_url: image,
        };
      })
    )
  ).filter((r): r is NonNullable<typeof r> => r !== null);

  if (!withImages.length) return NextResponse.json({ references: [] });
  const { data, error } = await client.from("iv_references").insert(withImages).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ references: data });
}
