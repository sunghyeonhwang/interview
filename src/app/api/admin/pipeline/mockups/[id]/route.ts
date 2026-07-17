import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";

type Params = { params: Promise<{ id: string }> };

// 목업 이미지 프록시 (?dl=1 이면 다운로드)
export async function GET(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const download = req.nextUrl.searchParams.get("dl") === "1";
  const client = db();

  const { data: mockup } = await client.from("iv_mockups").select("kind, image_path").eq("id", id).maybeSingle();
  if (!mockup) return NextResponse.json({ error: "목업을 찾을 수 없습니다." }, { status: 404 });

  const { data, error } = await client.storage
    .from("iv-concepts")
    .createSignedUrl(mockup.image_path, 3600, download ? { download: `mockup-${mockup.kind}.png` } : undefined);
  if (error || !data) return NextResponse.json({ error: "이미지 URL 생성 실패" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const client = db();

  const { data: mockup } = await client.from("iv_mockups").select("image_path").eq("id", id).maybeSingle();
  if (!mockup) return NextResponse.json({ error: "목업을 찾을 수 없습니다." }, { status: 404 });

  await client.storage.from("iv-concepts").remove([mockup.image_path]);
  const { error } = await client.from("iv_mockups").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
