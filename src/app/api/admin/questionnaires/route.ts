import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { data, error } = await db()
    .from("iv_questionnaires")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ questionnaires: data });
}

export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { title, description } = await req.json().catch(() => ({}));
  if (!title) return NextResponse.json({ error: "제목이 필요합니다." }, { status: 400 });
  const { data, error } = await db()
    .from("iv_questionnaires")
    .insert({ title, description: description ?? null })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ questionnaire: data });
}
