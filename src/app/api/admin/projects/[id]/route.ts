import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";

type Params = { params: Promise<{ id: string }> };

// 프로젝트 애셋 서명 URL 리다이렉트 (?i=0)
export async function GET(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const i = Number(new URL(req.url).searchParams.get("i") ?? "0");
  const client = db();

  const { data: project } = await client.from("iv_projects").select("asset_paths").eq("id", id).maybeSingle();
  const path = project?.asset_paths?.[i];
  if (!path) return NextResponse.json({ error: "애셋이 없습니다." }, { status: 404 });

  const { data, error } = await client.storage.from("iv-concepts").createSignedUrl(path, 3600);
  if (error || !data) return NextResponse.json({ error: "서명 URL 생성 실패" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}

// 프로젝트 삭제: 파이프라인 산출물 스토리지 정리 후 행 삭제 (브리프 이하 CASCADE)
export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const client = db();

  const { data: project } = await client.from("iv_projects").select("asset_paths").eq("id", id).maybeSingle();
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

  const removals: string[] = [...(project.asset_paths ?? [])];
  const { data: brief } = await client.from("iv_briefs").select("id").eq("project_id", id).maybeSingle();
  if (brief) {
    const { data: concepts } = await client
      .from("iv_concepts")
      .select("id, image_light_path, image_dark_path")
      .eq("brief_id", brief.id);
    for (const c of concepts ?? []) {
      if (c.image_light_path) removals.push(c.image_light_path);
      if (c.image_dark_path) removals.push(c.image_dark_path);
    }
    const conceptIds = (concepts ?? []).map((c) => c.id);
    if (conceptIds.length) {
      const { data: mockups } = await client.from("iv_mockups").select("image_path").in("concept_id", conceptIds);
      for (const m of mockups ?? []) if (m.image_path) removals.push(m.image_path);
    }
    const { data: refs } = await client.from("iv_references").select("image_path").eq("brief_id", brief.id);
    for (const r of refs ?? []) if (r.image_path) removals.push(r.image_path);
  }
  if (removals.length) await client.storage.from("iv-concepts").remove(removals);

  const { error } = await client.from("iv_projects").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
