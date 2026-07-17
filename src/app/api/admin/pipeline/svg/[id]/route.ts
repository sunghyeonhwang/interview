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

// 컬러 치환 등 수정본을 새 버전으로 저장 (원본 보존)
export async function PATCH(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const { svg } = (await req.json().catch(() => ({}))) as { svg?: string };
  if (!svg?.trim() || !/<svg[\s\S]*<\/svg>/i.test(svg)) {
    return NextResponse.json({ error: "유효한 SVG 코드가 필요합니다." }, { status: 400 });
  }
  const client = db();
  const { data: base } = await client.from("iv_svgs").select("concept_id").eq("id", id).single();
  if (!base) return NextResponse.json({ error: "SVG를 찾을 수 없습니다." }, { status: 404 });

  const { count } = await client
    .from("iv_svgs")
    .select("id", { count: "exact", head: true })
    .eq("concept_id", base.concept_id);
  const { data, error } = await client
    .from("iv_svgs")
    .insert({ concept_id: base.concept_id, svg: svg.trim(), version: (count ?? 0) + 1 })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ svg: data });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const { error } = await db().from("iv_svgs").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
