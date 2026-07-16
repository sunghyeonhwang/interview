import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import type { Question, ScaleOptions } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

function formatValue(q: Question, value: unknown): string {
  if (value == null || value === "") return "_(무응답)_";
  if (q.type === "multi" && Array.isArray(value)) return value.map((v) => `- ${v}`).join("\n");
  if (q.type === "scale") {
    const opt = (q.options ?? { min: 1, max: 5 }) as ScaleOptions;
    return `${value} / ${opt.max}${opt.maxLabel ? ` (${opt.minLabel ?? ""} ↔ ${opt.maxLabel})` : ""}`;
  }
  return String(value);
}

// 세션 응답을 마크다운으로 내보내기 → founder-interviewer 합성 입력용
export async function GET(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const client = db();

  const { data: session, error: sErr } = await client
    .from("iv_sessions")
    .select("*, iv_questionnaires(id, title, description)")
    .eq("id", id)
    .single();
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 404 });

  const { data: sections } = await client
    .from("iv_sections")
    .select("*, iv_questions(*)")
    .eq("questionnaire_id", session.iv_questionnaires.id)
    .order("order");

  const { data: answers } = await client
    .from("iv_answers")
    .select("question_id, value")
    .eq("session_id", id);
  const answerMap = new Map((answers ?? []).map((a) => [a.question_id, a.value]));

  const lines: string[] = [];
  lines.push(`# 인터뷰 응답: ${session.iv_questionnaires.title}`);
  lines.push("");
  lines.push(`- 응답자: ${session.respondent_name}`);
  if (session.respondent_email) lines.push(`- 이메일: ${session.respondent_email}`);
  lines.push(`- 상태: ${session.status === "submitted" ? "제출 완료" : session.status === "in_progress" ? "작성 중 (미제출)" : "미시작"}`);
  if (session.submitted_at) lines.push(`- 제출 일시: ${new Date(session.submitted_at).toLocaleString("ko-KR")}`);
  lines.push("");

  for (const s of sections ?? []) {
    lines.push(`## ${s.title}`);
    if (s.guide) lines.push(`> ${s.guide}`);
    lines.push("");
    const qs = (s.iv_questions ?? []).sort((a: Question, b: Question) => a.order - b.order);
    for (const q of qs) {
      lines.push(`### ${q.prompt}`);
      lines.push("");
      lines.push(formatValue(q, answerMap.get(q.id)));
      lines.push("");
    }
  }

  const md = lines.join("\n");
  return new NextResponse(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="interview-${encodeURIComponent(session.respondent_name)}-${id.slice(0, 8)}.md"`,
    },
  });
}
