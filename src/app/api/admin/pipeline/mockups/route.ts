import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import { generateImage, availableEngines, type ImageEngine } from "@/lib/ai";

export const maxDuration = 300;

// 목업 종류별 합성 프롬프트 (시안 이미지를 입력으로 사용)
export const dynamic = "force-dynamic";

const KINDS: Record<string, { label: string; prompt: string }> = {
  sign: {
    label: "간판",
    prompt:
      "Take the logo from the input image and apply it to a realistic photo of a modern building facade signage. Clean architectural photography, natural daylight, the logo prominently displayed on the sign. Keep the logo's exact shape and colors.",
  },
  card: {
    label: "명함",
    prompt:
      "Take the logo from the input image and apply it to an elegant business card mockup lying on a minimal desk. Premium paper texture, soft studio lighting, front and back cards visible. Keep the logo's exact shape and colors.",
  },
  appicon: {
    label: "앱 아이콘",
    prompt:
      "Take the logo from the input image and adapt it into a smartphone app icon shown on a phone home screen mockup. Rounded square icon, realistic phone screen photography. Keep the logo's exact shape and colors, simplified if needed for small size.",
  },
  uniform: {
    label: "유니폼",
    prompt:
      "Take the logo from the input image and embroider it on a professional staff uniform (polo shirt or medical gown) chest area, realistic apparel mockup photography. Keep the logo's exact shape and colors.",
  },
};

export function GET() {
  return NextResponse.json({ kinds: Object.entries(KINDS).map(([k, v]) => ({ kind: k, label: v.label })) });
}

// 목업 생성: 시안 라이트 이미지 → 합성 목업 1장
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { concept_id, kind, engine } = (await req.json().catch(() => ({}))) as {
    concept_id?: string;
    kind?: string;
    engine?: ImageEngine;
  };
  if (!concept_id || !kind || !KINDS[kind]) {
    return NextResponse.json({ error: "concept_id와 유효한 kind가 필요합니다." }, { status: 400 });
  }
  const client = db();

  const { data: concept } = await client
    .from("iv_concepts")
    .select("id, brief_id, engine, image_light_path")
    .eq("id", concept_id)
    .single();
  if (!concept) return NextResponse.json({ error: "시안을 찾을 수 없습니다." }, { status: 404 });

  const { data: img } = await client.storage.from("iv-concepts").download(concept.image_light_path);
  if (!img) return NextResponse.json({ error: "시안 이미지를 불러오지 못했습니다." }, { status: 500 });
  const input = Buffer.from(await img.arrayBuffer());

  // 엔진: 지정 > 시안의 엔진 > 사용 가능한 첫 엔진
  const engines = availableEngines();
  const useEngine: ImageEngine = engine && engines.includes(engine)
    ? engine
    : engines.includes(concept.engine as ImageEngine)
      ? (concept.engine as ImageEngine)
      : engines[0];
  if (!useEngine) return NextResponse.json({ error: "사용 가능한 이미지 엔진이 없습니다." }, { status: 400 });

  let buf: Buffer;
  try {
    buf = await generateImage(useEngine, KINDS[kind].prompt, input);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "목업 생성 실패" }, { status: 500 });
  }

  const path = `${concept.brief_id}/mockup-${kind}-${crypto.randomUUID().slice(0, 8)}.png`;
  const { error: upErr } = await client.storage
    .from("iv-concepts")
    .upload(path, buf, { contentType: "image/png", upsert: true });
  if (upErr) return NextResponse.json({ error: `목업 저장 실패: ${upErr.message}` }, { status: 500 });

  const { data, error } = await client
    .from("iv_mockups")
    .insert({ concept_id, kind, image_path: path })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ mockup: data });
}
