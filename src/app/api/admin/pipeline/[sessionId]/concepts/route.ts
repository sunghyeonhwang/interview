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
  const { direction: bodyDirection, engine: bodyEngine, prompt_override, options, variant_of } = (await req.json().catch(() => ({}))) as {
    direction?: string;
    engine?: ImageEngine;
    prompt_override?: string;
    options?: { logo_type?: string; color_hint?: string; extra?: string };
    variant_of?: string; // 기존 시안 id — 지정 시 해당 시안의 미세 변형을 생성
  };
  if (!variant_of && (!bodyDirection || !bodyEngine)) {
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

  // 변형 모드: 원본 시안을 로드해 방향·엔진을 물려받는다
  let variantSource: {
    id: string; direction: string; engine: string; prompt: string;
    rationale: string | null; image_light_path: string;
  } | null = null;
  if (variant_of) {
    const { data: src } = await client
      .from("iv_concepts")
      .select("id, direction, engine, prompt, rationale, image_light_path")
      .eq("id", variant_of)
      .eq("brief_id", brief.id)
      .maybeSingle();
    if (!src) return NextResponse.json({ error: "변형할 원본 시안을 찾을 수 없습니다." }, { status: 404 });
    variantSource = src;
  }
  const direction = variantSource ? variantSource.direction : bodyDirection!;
  const engine = (variantSource ? (bodyEngine ?? variantSource.engine) : bodyEngine) as ImageEngine;

  const dir = (brief.content?.directions ?? []).find(
    (d: { name: string }) => d.name === direction
  );

  const round: number = brief.current_round ?? 1;

  // 이번 회차의 이전 시안 프롬프트 수집 — 반복 생성 시 유사 시안 방지 (다양성 강제)
  const { data: priorConcepts } = await client
    .from("iv_concepts")
    .select("prompt")
    .eq("brief_id", brief.id)
    .eq("direction", direction)
    .eq("round", round)
    .order("created_at", { ascending: false })
    .limit(6);
  const priorPrompts = (priorConcepts ?? []).map((p) => p.prompt).filter(Boolean);

  // 2회차부터: 이전 회차의 선택 시안(발전 기반) + 그 평가 + 회차 피드백을 물려받는다
  let baseConcept: { rationale: string | null; prompt: string; image_light_path: string } | null = null;
  let baseEvalSummary = "";
  let roundFeedback = "";
  const baseImages: string[] = [];
  if (round > 1 && !variantSource) {
    const { data: prevSelected } = await client
      .from("iv_concepts")
      .select("id, rationale, prompt, image_light_path")
      .eq("brief_id", brief.id)
      .eq("round", round - 1)
      .eq("selected", true)
      .order("created_at", { ascending: false })
      .limit(1);
    baseConcept = prevSelected?.[0] ?? null;
    if (baseConcept) {
      const { data: ev } = await client
        .from("iv_evaluations")
        .select("summary")
        .eq("concept_id", (prevSelected![0] as { id: string }).id)
        .order("created_at", { ascending: false })
        .limit(1);
      baseEvalSummary = ev?.[0]?.summary ?? "";
      const { data: img } = await client.storage.from("iv-concepts").download(baseConcept.image_light_path);
      if (img) baseImages.push(Buffer.from(await img.arrayBuffer()).toString("base64"));
    }
    const fb = (brief.round_feedback ?? []) as { round: number; feedback: string }[];
    roundFeedback = fb.find((f) => f.round === round - 1)?.feedback ?? "";
  }

  // 1) 프롬프트 + 제작 의도 구성
  const optionLines = [
    options?.logo_type && `- 로고 유형: ${options.logo_type} 중심으로 구성할 것`,
    options?.color_hint && `- 컬러 지시: ${options.color_hint} — 팔레트에 반드시 반영할 것`,
    options?.extra && `- 추가 요청: ${options.extra}`,
  ].filter(Boolean);

  let composed: { image_prompt: string; rationale: string; palette: string[] };
  if (prompt_override) {
    composed = { image_prompt: prompt_override, rationale: "(수동 프롬프트)", palette: [] };
  } else if (variantSource) {
    // 변형 모드: 원본 이미지를 보며 핵심은 유지하고 디테일만 달리한다
    const { data: img } = await client.storage.from("iv-concepts").download(variantSource.image_light_path);
    const srcImages = img ? [Buffer.from(await img.arrayBuffer()).toString("base64")] : [];
    const text = await claudeCall({
      system: `너는 브랜드 아이덴티티 아트 디렉터다. 첨부된 이미지(기준 시안)의 "미세 변형(variation)"을 만든다.
규칙:
- 핵심 모티프·구성·무드는 그대로 유지한다. 완전히 새로운 방향 제안 금지.
- 디테일만 달리한다 — 선 굵기, 비율, 곡률, 세부 형태, 미묘한 톤 조정 중 1~2가지.
- 텍스트가 들어간다면 브랜드명만, 오탈자 없이 단순하게.`,
      prompt: `## 기준 시안 (첨부 이미지)
- 원 이미지 프롬프트: ${variantSource.prompt}
- 원 제작 의도: ${variantSource.rationale ?? "(없음)"}
${optionLines.length ? `\n## 관리자 옵션 (최우선 반영)\n${optionLines.join("\n")}` : ""}

기준 시안의 핵심을 유지한 채 디테일만 달리한 변형의 이미지 프롬프트·제작 의도·팔레트를 JSON으로 작성하라.`,
      images: srcImages,
      schema: COMPOSE_SCHEMA,
      effort: "medium",
    });
    composed = extractJSON(text);
  } else {
    const refineMode = round > 1 && baseConcept;
    const text = await claudeCall({
      system: refineMode
        ? `너는 브랜드 아이덴티티 아트 디렉터다. 지금은 ${round}회차 — 첨부된 이미지(이전 회차에서 선정된 시안)를 기반으로 "발전·정제"하는 단계다.
규칙:
- 선정 시안의 핵심 조형 언어(모티프·구성)는 유지하되, 회차 피드백과 평가 지적을 반영해 개선한다. 완전히 새로운 방향으로 튀지 않는다.
- 텍스트가 들어간다면 브랜드명만, 오탈자 없이 단순하게.`
        : `너는 브랜드 아이덴티티 아트 디렉터다. 브리프와 선택된 벤치마크 레퍼런스를 바탕으로,
선택 레퍼런스의 좋은 점을 이 브랜드에 맞게 "리디자인"한 로고 컨셉 시안의 이미지 생성 프롬프트를 만든다.
규칙:
- 레퍼런스를 베끼지 말고 원리(구성·무드·조형 언어)만 가져온다. 텍스트가 들어간다면 브랜드명만, 오탈자 없이 단순하게.
- "이미 시도한 접근" 목록이 있으면, 그것들과 조형적으로 뚜렷이 다른 새로운 접근(다른 심볼 모티프, 다른 구성, 다른 무드)을 제안한다. 색만 바꾼 변형은 금지.`,
      prompt: `## 브리프
포지셔닝: ${brief.content?.positioning}
키워드: ${(brief.content?.keywords ?? []).join(", ")}
피할 것: ${(brief.content?.anti ?? []).join(", ")}

## 선택 방향
${dir ? `${dir.name} — ${dir.concept} (무드: ${(dir.mood ?? []).join(", ")})` : direction}

## 선택된 레퍼런스 (${selectedRefs.length}개)
${selectedRefs.map((r) => `- ${r.brand_name}: ${r.summary}${r.note ? ` / 관리자 메모: ${r.note}` : ""}`).join("\n")}
${
  refineMode
    ? `\n## 발전 기반 (첨부 이미지 = ${round - 1}회차 선정 시안)
- 원 제작 의도: ${baseConcept!.rationale ?? "(없음)"}
${baseEvalSummary ? `- 평가 요약: ${baseEvalSummary}` : ""}
${roundFeedback ? `- ${round - 1}회차 피드백 (최우선 반영): ${roundFeedback}` : ""}`
    : ""
}
${optionLines.length ? `\n## 관리자 옵션 (최우선 반영)\n${optionLines.join("\n")}` : ""}
${priorPrompts.length ? `\n## 이번 회차에 이미 시도한 접근 (이것들과 다르게)\n${priorPrompts.map((p, i) => `${i + 1}. ${p.slice(0, 160)}`).join("\n")}` : ""}

위 재료로 로고 컨셉 시안의 이미지 프롬프트·제작 의도·팔레트를 JSON으로 작성하라.`,
      images: baseImages,
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
    .eq("engine", engine)
    .eq("round", round);
  const version = (count ?? 0) + 1;
  // Storage 키는 ASCII 안전 문자만 허용 — 한글 방향명은 슬러그+랜덤으로 대체
  const slug = direction.replace(/[^a-zA-Z0-9]+/g, "").slice(0, 24) || "dir";
  const baseKey = `${brief.id}/r${round}-${slug}-${engine}-v${version}-${crypto.randomUUID().slice(0, 8)}`;
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
      round,
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
