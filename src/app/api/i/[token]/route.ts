import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { Question, Section } from "@/lib/types";

type Params = { params: Promise<{ token: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findSession(token: string) {
  if (!UUID_RE.test(token)) return { error: "invalid" as const };
  const { data: session } = await db()
    .from("iv_sessions")
    .select("*")
    .eq("token", token)
    .single();
  if (!session) return { error: "notfound" as const };
  if (new Date(session.expires_at) < new Date()) return { error: "expired" as const };
  return { session };
}

// 응답자: 질문지 구조 + 저장된 답변 조회
export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params;
  const found = await findSession(token);
  if ("error" in found) {
    const msg = found.error === "expired" ? "링크가 만료되었습니다." : "유효하지 않은 링크입니다.";
    return NextResponse.json({ error: msg }, { status: found.error === "expired" ? 410 : 404 });
  }
  const { session } = found;
  const client = db();

  const { data: q } = await client
    .from("iv_questionnaires")
    .select("id, title, description, iv_sections(*, iv_questions(*))")
    .eq("id", session.questionnaire_id)
    .single();
  if (!q) return NextResponse.json({ error: "질문지를 찾을 수 없습니다." }, { status: 404 });

  const { data: answers } = await client
    .from("iv_answers")
    .select("question_id, value")
    .eq("session_id", session.id);

  const sections = (q.iv_sections ?? [])
    .sort((a: Section, b: Section) => a.order - b.order)
    .map((s: Section & { iv_questions: Question[] }) => ({
      id: s.id,
      title: s.title,
      guide: s.guide,
      questions: (s.iv_questions ?? []).sort((a, b) => a.order - b.order),
    }));

  return NextResponse.json({
    questionnaire: { title: q.title, description: q.description, sections },
    respondent_name: session.respondent_name,
    respondent_email: session.respondent_email ?? "",
    status: session.status,
    answers: Object.fromEntries((answers ?? []).map((a) => [a.question_id, a.value])),
  });
}

// 자동 임시저장: { answers: { [questionId]: value } }
export async function PATCH(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const found = await findSession(token);
  if ("error" in found) return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 404 });
  const { session } = found;
  if (session.status === "submitted") {
    return NextResponse.json({ error: "이미 제출된 인터뷰입니다." }, { status: 409 });
  }

  const body = await req.json().catch(() => null);

  // 이메일 저장 (인트로 화면에서 전달)
  if (typeof body?.email === "string") {
    const email = body.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "올바른 이메일 형식이 아닙니다." }, { status: 400 });
    }
    const { error } = await db()
      .from("iv_sessions")
      .update({ respondent_email: email })
      .eq("id", session.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!body?.answers) return NextResponse.json({ ok: true });
  }

  const answers = body?.answers;
  if (!answers || typeof answers !== "object") {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const client = db();

  // 세션에 속한 질문지의 문항만 저장 허용
  const { data: valid } = await client
    .from("iv_questions")
    .select("id, iv_sections!inner(questionnaire_id)")
    .eq("iv_sections.questionnaire_id", session.questionnaire_id);
  const validIds = new Set((valid ?? []).map((v) => v.id));

  const rows = Object.entries(answers)
    .filter(([qid]) => validIds.has(qid))
    .map(([qid, value]) => ({
      session_id: session.id,
      question_id: qid,
      value: value as object,
      updated_at: new Date().toISOString(),
    }));

  if (rows.length) {
    const { error } = await client
      .from("iv_answers")
      .upsert(rows, { onConflict: "session_id,question_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (session.status === "pending") {
    await client.from("iv_sessions").update({ status: "in_progress" }).eq("id", session.id);
  }
  return NextResponse.json({ ok: true, saved: rows.length });
}

// 최종 제출
export async function POST(_req: NextRequest, { params }: Params) {
  const { token } = await params;
  const found = await findSession(token);
  if ("error" in found) return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 404 });
  const { session } = found;
  if (session.status === "submitted") {
    return NextResponse.json({ error: "이미 제출된 인터뷰입니다." }, { status: 409 });
  }
  const { error } = await db()
    .from("iv_sessions")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("id", session.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
