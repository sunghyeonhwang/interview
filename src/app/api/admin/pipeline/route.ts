import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";

// 디자인 파이프라인 목록: 제출된 세션 + 파이프라인 진행 현황
export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const client = db();

  const { data: sessions } = await client
    .from("iv_sessions")
    .select("id, respondent_name, status, submitted_at, iv_questionnaires(title)")
    .eq("status", "submitted")
    .order("submitted_at", { ascending: false });

  const sessionIds = (sessions ?? []).map((s) => s.id);
  const { data: briefs } = sessionIds.length
    ? await client.from("iv_briefs").select("id, session_id, updated_at, current_round").in("session_id", sessionIds)
    : { data: [] };

  const briefIds = (briefs ?? []).map((b) => b.id);
  const refCounts: Record<string, number> = {};
  const conceptCounts: Record<string, number> = {};
  const svgCounts: Record<string, number> = {};
  const evalCounts: Record<string, number> = {};
  if (briefIds.length) {
    const [refs, concepts] = await Promise.all([
      client.from("iv_references").select("brief_id").in("brief_id", briefIds),
      client.from("iv_concepts").select("id, brief_id").in("brief_id", briefIds),
    ]);
    for (const r of refs.data ?? []) refCounts[r.brief_id] = (refCounts[r.brief_id] ?? 0) + 1;
    for (const c of concepts.data ?? []) conceptCounts[c.brief_id] = (conceptCounts[c.brief_id] ?? 0) + 1;
    const conceptIds = (concepts.data ?? []).map((c) => c.id);
    if (conceptIds.length) {
      const conceptToBrief = new Map((concepts.data ?? []).map((c) => [c.id, c.brief_id]));
      const [{ data: svgs }, { data: evals }] = await Promise.all([
        client.from("iv_svgs").select("concept_id").in("concept_id", conceptIds),
        client.from("iv_evaluations").select("concept_id").in("concept_id", conceptIds),
      ]);
      for (const s of svgs ?? []) {
        const bid = conceptToBrief.get(s.concept_id);
        if (bid) svgCounts[bid] = (svgCounts[bid] ?? 0) + 1;
      }
      const evaluated = new Set<string>(); // 같은 시안 재평가는 1개로 센다
      for (const e of evals ?? []) {
        if (evaluated.has(e.concept_id)) continue;
        evaluated.add(e.concept_id);
        const bid = conceptToBrief.get(e.concept_id);
        if (bid) evalCounts[bid] = (evalCounts[bid] ?? 0) + 1;
      }
    }
  }

  const briefBySession = new Map((briefs ?? []).map((b) => [b.session_id, b]));
  const items = (sessions ?? []).map((s) => {
    const brief = briefBySession.get(s.id);
    return {
      session_id: s.id,
      respondent_name: s.respondent_name,
      questionnaire_title: (s.iv_questionnaires as unknown as { title: string } | null)?.title ?? "",
      submitted_at: s.submitted_at,
      has_brief: !!brief,
      current_round: brief?.current_round ?? 1,
      references: brief ? (refCounts[brief.id] ?? 0) : 0,
      concepts: brief ? (conceptCounts[brief.id] ?? 0) : 0,
      evaluations: brief ? (evalCounts[brief.id] ?? 0) : 0,
      svgs: brief ? (svgCounts[brief.id] ?? 0) : 0,
    };
  });

  return NextResponse.json({ items });
}
