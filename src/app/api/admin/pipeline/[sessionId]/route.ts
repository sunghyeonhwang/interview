import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import { availableEngines } from "@/lib/ai";

type Params = { params: Promise<{ sessionId: string }> };

// 파이프라인 전체 상태 조회 (인터뷰 데이터는 읽기 전용)
export async function GET(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { sessionId } = await params;
  const client = db();

  const { data: session } = await client
    .from("iv_sessions")
    .select("id, respondent_name, status, iv_questionnaires(title)")
    .eq("id", sessionId)
    .single();
  if (!session) return NextResponse.json({ error: "세션을 찾을 수 없습니다." }, { status: 404 });

  const { data: brief } = await client
    .from("iv_briefs")
    .select("*")
    .eq("session_id", sessionId)
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
    brief,
    references,
    concepts,
    svgs,
    evaluations,
    engines: availableEngines(),
    claudeReady: !!process.env.ANTHROPIC_API_KEY,
  });
}
