import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import { claudeCall, extractJSON, generateImage, type ImageEngine } from "@/lib/ai";

export const maxDuration = 300;

type Params = { params: Promise<{ sessionId: string }> };

const COMPOSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["image_prompt", "rationale", "palette"],
  properties: {
    image_prompt: {
      type: "string",
      description:
        "영문 이미지 생성 프롬프트. 로고 컨셉 시안: 로고 마크 + 브랜드명 배치, 스타일·구성·질감을 구체적으로. 배경 지정 문구는 넣지 말 것(라이트/다크는 별도 부가됨).",
    },
    rationale: { type: "string", description: "제작 의도 설명 (한국어, 3~5문장): 어떤 인터뷰 근거·레퍼런스에서 출발했고 무엇을 표현하려 했는지" },
    palette: { type: "array", items: { type: "string" }, description: "핵심 컬러 HEX 목록 (3~5개)" },
  },
};

// 시안 1건 생성: 프롬프트·제작의도 구성(Claude) → 라이트/다크 이미지 2장(선택 엔진) → Storage 저장
export async function POST(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { sessionId } = await params;
  const { direction, engine, prompt_override } = (await req.json().catch(() => ({}))) as {
    direction?: string;
    engine?: ImageEngine;
    prompt_override?: string;
  };
  if (!direction || !engine) {
    return NextResponse.json({ error: "direction과 engine이 필요합니다." }, { status: 400 });
  }
  const client = db();

  const { data: brief } = await client
    .from("iv_briefs")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (!brief) return NextResponse.json({ error: "브리프를 먼저 생성하세요." }, { status: 400 });

  const { data: selectedRefs } = await client
    .from("iv_references")
    .select("id, brand_name, summary, note")
    .eq("brief_id", brief.id)
    .eq("selected", true);
  if (!selectedRefs?.length) {
    return NextResponse.json({ error: "레퍼런스를 1개 이상 선택하세요." }, { status: 400 });
  }

  const dir = (brief.content?.directions ?? []).find(
    (d: { name: string }) => d.name === direction
  );

  // 1) 프롬프트 + 제작 의도 구성
  let composed: { image_prompt: string; rationale: string; palette: string[] };
  if (prompt_override) {
    composed = { image_prompt: prompt_override, rationale: "(수동 프롬프트)", palette: [] };
  } else {
    const text = await claudeCall({
      system: `너는 브랜드 아이덴티티 아트 디렉터다. 브리프와 선택된 벤치마크 레퍼런스를 바탕으로,
선택 레퍼런스의 좋은 점을 이 브랜드에 맞게 "리디자인"한 로고 컨셉 시안의 이미지 생성 프롬프트를 만든다.
레퍼런스를 베끼지 말고 원리(구성·무드·조형 언어)만 가져온다. 텍스트가 들어간다면 브랜드명만, 오탈자 없이 단순하게.`,
      prompt: `## 브리프
포지셔닝: ${brief.content?.positioning}
키워드: ${(brief.content?.keywords ?? []).join(", ")}
피할 것: ${(brief.content?.anti ?? []).join(", ")}

## 선택 방향
${dir ? `${dir.name} — ${dir.concept} (무드: ${(dir.mood ?? []).join(", ")})` : direction}

## 선택된 레퍼런스 (${selectedRefs.length}개)
${selectedRefs.map((r) => `- ${r.brand_name}: ${r.summary}${r.note ? ` / 관리자 메모: ${r.note}` : ""}`).join("\n")}

위 재료로 로고 컨셉 시안의 이미지 프롬프트·제작 의도·팔레트를 JSON으로 작성하라.`,
      schema: COMPOSE_SCHEMA,
    effort: "medium",
    });
    composed = extractJSON(text);
  }

  // 2) 라이트/다크 2장 생성
  const base = composed.image_prompt;
  const [light, dark] = await Promise.all([
    generateImage(engine, `${base}\n\nPresented on a clean white background, light mode version. Professional brand identity presentation, high quality, centered composition.`),
    generateImage(engine, `${base}\n\nPresented on a very dark charcoal background (#0a0c02), dark mode version with adjusted colors for dark background legibility. Professional brand identity presentation, high quality, centered composition.`),
  ]);

  // 3) Storage 업로드
  const { count } = await client
    .from("iv_concepts")
    .select("id", { count: "exact", head: true })
    .eq("brief_id", brief.id)
    .eq("direction", direction)
    .eq("engine", engine);
  const version = (count ?? 0) + 1;
  const baseKey = `${brief.id}/${encodeURIComponent(direction)}-${engine}-v${version}`;
  const lightPath = `${baseKey}-light.png`;
  const darkPath = `${baseKey}-dark.png`;

  for (const [path, buf] of [
    [lightPath, light],
    [darkPath, dark],
  ] as const) {
    const { error } = await client.storage
      .from("iv-concepts")
      .upload(path, buf, { contentType: "image/png", upsert: true });
    if (error) return NextResponse.json({ error: `이미지 저장 실패: ${error.message}` }, { status: 500 });
  }

  const { data, error } = await client
    .from("iv_concepts")
    .insert({
      brief_id: brief.id,
      direction,
      engine,
      version,
      prompt: composed.image_prompt,
      rationale: composed.rationale,
      palette: composed.palette,
      image_light_path: lightPath,
      image_dark_path: darkPath,
      reference_ids: selectedRefs.map((r) => r.id),
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ concept: data });
}
