import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";

export const maxDuration = 120;

// 고아 스토리지 정리: DB에서 참조되지 않는 iv-concepts 파일을 삭제한다.
// 안전장치 — 생성 30분 이내 파일은 진행 중 작업 보호를 위해 건너뛴다.
export async function POST() {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const client = db();

  // DB가 참조하는 모든 스토리지 경로
  const [{ data: concepts }, { data: projects }, { data: mockups }, { data: refs }] = await Promise.all([
    client.from("iv_concepts").select("image_light_path, image_dark_path"),
    client.from("iv_projects").select("asset_paths"),
    client.from("iv_mockups").select("image_path"),
    client.from("iv_references").select("image_path"),
  ]);
  const referenced = new Set<string>();
  for (const c of concepts ?? []) {
    if (c.image_light_path) referenced.add(c.image_light_path);
    if (c.image_dark_path) referenced.add(c.image_dark_path);
  }
  for (const p of projects ?? []) for (const a of p.asset_paths ?? []) referenced.add(a);
  for (const m of mockups ?? []) if (m.image_path) referenced.add(m.image_path);
  for (const r of refs ?? []) if (r.image_path) referenced.add(r.image_path);

  // 버킷 전체 파일 재귀 수집
  const cutoff = Date.now() - 30 * 60 * 1000;
  const orphans: string[] = [];
  let orphanBytes = 0;
  let scanned = 0;
  async function walk(prefix: string) {
    const { data } = await client.storage.from("iv-concepts").list(prefix, { limit: 1000 });
    for (const e of data ?? []) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (!e.id) {
        await walk(path); // 폴더
        continue;
      }
      scanned++;
      if (referenced.has(path)) continue;
      if (e.created_at && new Date(e.created_at).getTime() > cutoff) continue; // 진행 중 생성 보호
      orphans.push(path);
      orphanBytes += (e.metadata as { size?: number } | null)?.size ?? 0;
    }
  }
  await walk("");

  if (orphans.length) {
    // remove()는 한 번에 최대 수백 건 — 100개 단위 배치
    for (let i = 0; i < orphans.length; i += 100) {
      const { error } = await client.storage.from("iv-concepts").remove(orphans.slice(i, i + 100));
      if (error) return NextResponse.json({ error: `정리 중 오류: ${error.message}` }, { status: 500 });
    }
  }

  return NextResponse.json({
    scanned,
    removed: orphans.length,
    freed_mb: Math.round((orphanBytes / 1024 / 1024) * 10) / 10,
  });
}
