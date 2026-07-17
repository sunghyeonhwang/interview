import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.selected === "boolean") patch.selected = body.selected;
  if (typeof body.starred === "boolean") patch.starred = body.starred;
  if (!Object.keys(patch).length) return NextResponse.json({ error: "변경 사항 없음" }, { status: 400 });
  const { data, error } = await db().from("iv_concepts").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ concept: data });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const client = db();
  const { data: concept } = await client.from("iv_concepts").select("*").eq("id", id).single();
  if (concept) {
    const { data: mockups } = await client.from("iv_mockups").select("image_path").eq("concept_id", id);
    await client.storage
      .from("iv-concepts")
      .remove(
        [concept.image_light_path, concept.image_dark_path, ...(mockups ?? []).map((m) => m.image_path)].filter(Boolean)
      );
  }
  const { error } = await client.from("iv_concepts").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
