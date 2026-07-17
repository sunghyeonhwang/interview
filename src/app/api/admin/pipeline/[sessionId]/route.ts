import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import { availableEngines } from "@/lib/ai";
import { ownerFilter } from "@/lib/pipeline";

type Params = { params: Promise<{ sessionId: string }> };

// 파이프라인 전체 상태 조회 — 인터뷰 세션(읽기 전용) 또는 애셋 프로젝트
export async function GET(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { sessionId } = await params;
  const client = db();

  const { data: session } = await client
    .from("iv_sessions")
    .select("id, respondent_name, status, iv_questionnaires(title)")
    .eq("id", sessionId)
    .maybeSingle();

  let project: Record<string, unknown> | null = null;
  if (!session) {
    const { data: p } = await client.from("iv_projects").select("*").eq("id", sessionId).maybeSingle();
    if (!p) return NextResponse.json({ error: "세션/프로젝트를 찾을 수 없습니다." }, { status: 404 });
    // 애셋 미리보기용 서명 URL (1시간)
    const paths = (p.asset_paths ?? []) as string[];
    const { data: signed } = paths.length
      ? await client.storage.from("iv-concepts").createSignedUrls(paths, 3600)
      : { data: [] };
    project = { ...p, asset_urls: (signed ?? []).map((s) => s.signedUrl).filter(Boolean) };
  }

  const { data: brief } = await client
    .from("iv_briefs")
    .select("*")
    .or(ownerFilter(sessionId))
    .maybeSingle();

  let references: unknown[] = [];
  let concepts: unknown[] = [];
  let svgs: unknown[] = [];
  let evaluations: unknown[] = [];
  if (brief) {
    const [r, c] = await Promise.all([
      client.from("iv_references").select("*").eq("brief_id", brief.id).order("created_at"),
      client.from("iv_concepts").select("*").eq("brief_id", brief.id).order("created_at"),
    ]);
    references = r.data ?? [];
    concepts = c.data ?? [];
    const conceptIds = (c.data ?? []).map((x) => x.id);
    if (conceptIds.length) {
      const [s, e] = await Promise.all([
        client.from("iv_svgs").select("*").in("concept_id", conceptIds).order("created_at"),
        client.from("iv_evaluations").select("*").in("concept_id", conceptIds).order("created_at", { ascending: false }),
      ]);
      svgs = s.data ?? [];
      evaluations = e.data ?? [];
    }
  }

  return NextResponse.json({
    session,
    project,
    brief,
    references,
    concepts,
    svgs,
    evaluations,
    engines: availableEngines(),
    claudeReady: !!process.env.ANTHROPIC_API_KEY,
  });
}
