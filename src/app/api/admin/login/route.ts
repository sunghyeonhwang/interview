import { NextRequest, NextResponse } from "next/server";
import { createAdminSession } from "@/lib/adminSession";

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({}));
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: "서버에 관리자 비밀번호가 설정되지 않았습니다." }, { status: 500 });
  }
  if (typeof password !== "string" || password !== expected) {
    return NextResponse.json({ error: "비밀번호가 올바르지 않습니다." }, { status: 401 });
  }
  await createAdminSession();
  return NextResponse.json({ ok: true });
}
