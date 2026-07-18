import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";

type Params = { params: Promise<{ id: string }> };

// 레퍼런스 썸네일 — 스냅샷(Storage) 우선, 없으면 외부 원본으로 리다이렉트
export async function GET(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const client = db();

  const { data: ref } = await client.from("iv_references").select("image_path, image_url").eq("id", id).maybeSingle();
  if (!ref) return NextResponse.json({ error: "레퍼런스를 찾을 수 없습니다." }, { status: 404 });

  if (ref.image_path) {
    const { data } = await client.storage.from("iv-concepts").createSignedUrl(ref.image_path, 3600);
    if (data) return NextResponse.redirect(data.signedUrl);
  }
  if (ref.image_url) return NextResponse.redirect(ref.image_url);
  return NextResponse.json({ error: "이미지가 없습니다." }, { status: 404 });
}
