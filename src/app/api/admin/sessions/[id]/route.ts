import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";

type Params = { params: Promise<{ id: string }> };

// 세션 상세: 세션 + 질문지 구조 + 답변
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

  const { data: answers, error: aErr } = await client
    .from("iv_answers")
    .select("question_id, value, updated_at")
    .eq("session_id", id);
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });

  return NextResponse.json({ session, answers });
}

// 제출된 세션의 수정 잠금 해제 (status → in_progress) — 응답자가 같은 링크로 이어서 수정 가능
export async function PATCH(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const { action } = await req.json().catch(() => ({}));
  if (action !== "unlock") return NextResponse.json({ error: "지원하지 않는 동작입니다." }, { status: 400 });
  const { error } = await db()
    .from("iv_sessions")
    .update({ status: "in_progress", submitted_at: null })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const { error } = await db().from("iv_sessions").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
