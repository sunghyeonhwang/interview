import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";

// 응답자 업로드 이미지 프록시 (iv-uploads 비공개 버킷 → 서명 URL 리다이렉트).
// iv-concepts img 라우트 선례와 동일 구조. isAdmin 게이트로 관리자만 열람.
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "경로가 필요합니다." }, { status: 400 });

  const { data, error } = await db().storage.from("iv-uploads").createSignedUrl(path, 3600);
  if (error || !data) return NextResponse.json({ error: "이미지를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
