import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";

type Params = { params: Promise<{ id: string }> };

// SVG 파일 다운로드
export async function GET(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const { data } = await db().from("iv_svgs").select("svg, version, concept_id").eq("id", id).single();
  if (!data) return NextResponse.json({ error: "SVG를 찾을 수 없습니다." }, { status: 404 });
  return new NextResponse(data.svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="logo-${id.slice(0, 8)}-v${data.version}.svg"`,
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const { error } = await db().from("iv_svgs").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
