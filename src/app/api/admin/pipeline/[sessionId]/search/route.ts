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

// 썸네일을 Storage에 스냅샷 — 외부 링크가 죽어도 유지되고, 시안 생성 시 재다운로드가 없다
async function snapshotImage(client: ReturnType<typeof db>, briefId: string, imageUrl: string): Promise<string | null> {
  if (!imageUrl || imageUrl.includes("s2/favicons")) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(imageUrl, { signal: controller.signal, headers: BROWSER_HEADERS });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[ct];
    if (!ext) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 6 * 1024 * 1024) return null;
    const path = `refs/${briefId}/${crypto.randomUUID().slice(0, 8)}.${ext}`;
    const { error } = await client.storage.from("iv-concepts").upload(path, buf, { contentType: ct, upsert: true });
    return error ? null : path;
  } catch {
    return null;
  }
}

function faviconFor(url: string): string {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=256`;
  } catch {
    return "";
  }
}

// Jina Reader 경유 fetch (Vercel IP·봇 차단 우회) — 무료 티어 20회/분 대비 호출 간격 + 429 재시도.
// JINA_API_KEY 환경변수가 있으면 사용 (한도 상향).
let lastJinaCall = 0;
async function jinaFetch(url: string, ms = 25_000): Promise<string> {
  const wait = lastJinaCall + 1500 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const headers: Record<string, string> = {};
  if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    lastJinaCall = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(`https://r.jina.ai/${url}`, { signal: controller.signal, headers });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 4500));
        continue;
      }
      if (!res.ok) throw new Error(`jina ${res.status}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("jina rate limited");
}

// Jina 마크다운에서 대표 이미지 추출 (Behance CDN 우선)
function imageFromMarkdown(md: string): string {
  return (
    md.match(/https:\/\/mir-s3-cdn-cf\.behance\.net\/[^)\s"']+/)?.[0] ??
    md.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+\.(?:png|jpe?g|webp|gif)[^)\s]*)\)/i)?.[1] ??
    md.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/)?.[1] ??
    ""
  );
}

// URL 생존 검증 + 대표 이미지 해석.
// 반환: 이미지 URL | favicon(살아있지만 이미지 추출 실패) | null(404 등 죽은 링크 — 레퍼런스에서 제외)
async function verifyAndResolve(url: string): Promise<string | null> {
  // 1) 직접 접근 (브라우저급 헤더) — 차단 없는 일반 사이트용
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6500);
    const res = await fetch(url, { signal: controller.signal, headers: BROWSER_HEADERS, redirect: "follow" });
    clearTimeout(timer);
    if ([404, 410].includes(res.status)) return null; // AI가 지어낸 죽은 링크
    if (res.ok) {
      const og = extractOg((await res.text()).slice(0, 300_000), url);
      if (og) return og;
    }
    // 403/429 등 봇 차단 의심 → Jina 경유로 재시도
  } catch {
    /* 네트워크 실패 → Jina 시도 */
  }
  // 2) Jina Reader 마크다운 경유 (Behance 등 데이터센터 IP 차단 사이트 대응)
  try {
    const md = await jinaFetch(url, 20_000);
    if (/Warning: Target URL returned error 404/i.test(md)) return null;
    return imageFromMarkdown(md) || faviconFor(url);
  } catch {
    return faviconFor(url);
  }
}

// pid → 이미지 매칭 공통 로직: CDN 파일명에 프로젝트 ID가 포함됨, 고해상(max_808) 우선
function pickImage(images: string[], pid: string): string {
  const candidates = images.filter((u) => u.includes(pid));
  return candidates.find((u) => u.includes("max_808")) ?? candidates[0] ?? "";
}

// Behance 검색 ① 직접 HTML 파싱 (로컬·비차단 환경에서 빠름)
async function behanceSearchDirect(query: string): Promise<(FoundRef & { image_url: string })[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://www.behance.net/search/projects?search=${encodeURIComponent(query)}`,
      { signal: controller.signal, headers: BROWSER_HEADERS }
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
      out.push({
        brand_name: title.replace(/&amp;/g, "&").replace(/&#39;/g, "'"),
        url: `https://www.behance.net${path}`,
        summary: `Behance 프로젝트 — 검색어: ${query}`,
        image_url: pickImage(images, pid),
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

// Behance 검색 ② Jina 마크다운 파싱 (Vercel 등 Behance가 차단하는 IP에서 사용)
async function behanceSearchViaJina(query: string): Promise<(FoundRef & { image_url: string })[]> {
  try {
    const md = await jinaFetch(
      `https://www.behance.net/search/projects?search=${encodeURIComponent(query)}`,
      30_000
    );
    // [제목](gallery URL) 형태의 링크 — 중첩 이미지 링크([![...)는 브래킷 제외 규칙으로 걸러짐
    const links = [...md.matchAll(/\[([^[\]]{2,100})\]\(https:\/\/www\.behance\.net\/gallery\/(\d+)\/([^)?\s]+)[^)]*\)/g)];
    const images = [...new Set([...md.matchAll(/(https:\/\/mir-s3-cdn-cf\.behance\.net\/[^)\s"']+)/g)].map((m) => m[1]))];
    const seen = new Set<string>();
    const out: (FoundRef & { image_url: string })[] = [];
    for (const [, title, pid, slug] of links) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      out.push({
        brand_name: title.replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim(),
        url: `https://www.behance.net/gallery/${pid}/${slug}`,
        summary: `Behance 프로젝트 — 검색어: ${query}`,
        image_url: pickImage(images, pid),
      });
      if (out.length >= 12) break;
    }
    return out;
  } catch {
    return [];
  }
}

// Behance 검색: 직접 시도 → 결과 없으면(차단 환경) Jina 경유
async function behanceSearch(query: string): Promise<(FoundRef & { image_url: string })[]> {
  const direct = await behanceSearchDirect(query);
  if (direct.length) return direct;
  return behanceSearchViaJina(query);
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

  // ── 수동 등록: 운영자가 아는 사례 URL을 직접 추가 (query 필드 = URL) ──
  if (source === "manual") {
    const target = (query ?? "").trim();
    if (!/^https?:\/\//i.test(target)) {
      return NextResponse.json({ error: "http(s)로 시작하는 URL을 입력하세요." }, { status: 400 });
    }
    const image = await verifyAndResolve(target);
    if (image === null) return NextResponse.json({ error: "접속할 수 없는 링크입니다 (404)." }, { status: 400 });
    let title = "";
    try {
      const html = await fetchText(target, 6500, BROWSER_HEADERS);
      title = html.match(/<title[^>]*>([^<]{1,150})/i)?.[1]?.trim() ?? "";
    } catch {
      // 직접 접근 차단 시 Jina 마크다운의 Title: 라인 사용
      try {
        title = (await jinaFetch(target, 20_000)).match(/^Title:\s*(.{1,150})$/m)?.[1]?.trim() ?? "";
      } catch {
        /* 제목 없이 진행 */
      }
    }
    const brandName =
      title.replace(/&amp;/g, "&").replace(/\s*(::|[|–—-])\s*(Behance|BP&O|Brand New|Under ?Consideration).*$/i, "").trim().slice(0, 60) ||
      new URL(target).hostname;
    const imagePath = await snapshotImage(client, brief.id, image);
    const { data, error } = await client
      .from("iv_references")
      .insert({
        brief_id: brief.id,
        direction: direction ?? "custom",
        brand_name: brandName,
        url: target,
        summary: "직접 추가한 레퍼런스",
        image_url: image,
        image_path: imagePath,
      })
      .select();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ references: data });
  }

  // ── Behance 직접 검색 경로 (Claude 불필요) ──
  if (source === "behance") {
    // Jina 폴백의 호출 간격 유지를 위해 쿼리를 순차 실행
    const results: (FoundRef & { image_url: string })[] = [];
    for (const q of queries.slice(0, 2)) results.push(...(await behanceSearch(q)));
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
    const withSnaps = await Promise.all(
      rows.map(async (r) => ({ ...r, image_path: await snapshotImage(client, brief.id, r.image_url) }))
    );
    const { data, error } = await client.from("iv_references").insert(withSnaps).select();
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

  // Pinterest 이중 차단 + URL 생존 검증 + 이미지 해석 — Jina 속도 제한 준수를 위해 순차 처리
  const cleaned = found.filter((r) => r.url && !/pinterest|pin\.it/i.test(r.url));
  const withImages: {
    brief_id: string; direction: string; brand_name: string; url: string;
    summary: string; image_url: string; image_path: string | null;
  }[] = [];
  for (const r of cleaned) {
    const image = await verifyAndResolve(r.url);
    if (image === null) continue; // 404 — AI가 지어낸 링크
    withImages.push({
      brief_id: brief.id,
      direction: direction ?? "custom",
      brand_name: r.brand_name,
      url: r.url,
      summary: r.summary,
      image_url: image,
      image_path: await snapshotImage(client, brief.id, image),
    });
  }

  if (!withImages.length) return NextResponse.json({ references: [] });
  const { data, error } = await client.from("iv_references").insert(withImages).select();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ references: data });
}
