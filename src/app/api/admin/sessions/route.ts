import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { data, error } = await db()
    .from("iv_sessions")
    .select("*, iv_questionnaires(title)")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sessions: data });
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { questionnaire_id, respondent_name, expires_in_days } = await req.json().catch(() => ({}));
  if (!questionnaire_id || !respondent_name) {
    return NextResponse.json({ error: "질문지와 응답자 이름이 필요합니다." }, { status: 400 });
  }
  const days = Number(expires_in_days) > 0 ? Number(expires_in_days) : 30;
  const { data, error } = await db()
    .from("iv_sessions")
    .insert({
      questionnaire_id,
      respondent_name,
      expires_at: new Date(Date.now() + days * 86400_000).toISOString(),
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}
