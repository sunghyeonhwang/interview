import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";

export const maxDuration = 60;

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// 애셋 프로젝트 생성: 브랜드 정보 + 로고 애셋 업로드 (FormData)
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

  const title = String(form.get("title") ?? "").trim();
  const brandName = String(form.get("brand_name") ?? "").trim();
  const goal = String(form.get("goal") ?? "").trim();
  const keyColors = String(form.get("key_colors") ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const files = form.getAll("assets").filter((f): f is File => f instanceof File && f.size > 0);

  if (!title || !brandName) {
    return NextResponse.json({ error: "프로젝트명과 브랜드명이 필요합니다." }, { status: 400 });
  }
  for (const f of files) {
    if (!ALLOWED_TYPES.has(f.type)) {
      return NextResponse.json({ error: `지원하지 않는 파일 형식: ${f.name} (PNG/JPG/WebP만 가능)` }, { status: 400 });
    }
    if (f.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: `파일이 너무 큽니다: ${f.name} (8MB 이하)` }, { status: 400 });
    }
  }

  const client = db();
  const id = crypto.randomUUID();
  const assetPaths: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const ext = files[i].type === "image/jpeg" ? "jpg" : files[i].type === "image/webp" ? "webp" : "png";
    const path = `projects/${id}/asset-${i + 1}.${ext}`;
    const { error } = await client.storage
      .from("iv-concepts")
      .upload(path, Buffer.from(await files[i].arrayBuffer()), { contentType: files[i].type, upsert: true });
    if (error) return NextResponse.json({ error: `애셋 업로드 실패: ${error.message}` }, { status: 500 });
    assetPaths.push(path);
  }

  const { data, error } = await client
    .from("iv_projects")
    .insert({ id, title, brand_name: brandName, goal: goal || null, key_colors: keyColors, asset_paths: assetPaths })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ project: data });
}
