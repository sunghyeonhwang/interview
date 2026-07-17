import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";

type Params = { params: Promise<{ id: string }> };

// 시안 이미지 프록시 (비공개 버킷 → 서명 URL 리다이렉트)
export async function GET(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const mode = req.nextUrl.searchParams.get("mode") === "dark" ? "dark" : "light";
  const download = req.nextUrl.searchParams.get("dl") === "1";
  const client = db();

  const { data: concept } = await client
    .from("iv_concepts")
    .select("direction, engine, round, version, image_light_path, image_dark_path")
    .eq("id", id)
    .single();
  if (!concept) return NextResponse.json({ error: "시안을 찾을 수 없습니다." }, { status: 404 });

  const path = mode === "dark" ? concept.image_dark_path : concept.image_light_path;
  const filename = `${concept.direction}-r${concept.round}-${concept.engine}-v${concept.version}-${mode}.png`;
  const { data, error } = await client.storage
    .from("iv-concepts")
    .createSignedUrl(path, 3600, download ? { download: filename } : undefined);
  if (error || !data) return NextResponse.json({ error: "이미지 URL 생성 실패" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
