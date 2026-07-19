import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import { ownerFilter } from "@/lib/pipeline";
import { claudeCall, extractJSON, generateImageEx, sniffMediaType, type ImageEngine, type VisionImage } from "@/lib/ai";

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

// 레퍼런스 썸네일을 비전 입력용으로 다운로드 (파비콘·비이미지·대용량 제외)
async function fetchRefImage(url: string): Promise<VisionImage | null> {
  if (!url || url.includes("s2/favicons")) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(ct)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 4 * 1024 * 1024) return null;
    return { data: buf.toString("base64"), media_type: ct as VisionImage["media_type"] };
  } catch {
    return null;
  }
}

// 이미지 속 텍스트 오탈자 검사 스키마
const TEXT_CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "found"],
  properties: {
    ok: { type: "boolean", description: "텍스트가 깨끗하면 true (텍스트가 아예 없어도 true)" },
    found: { type: "string", description: "발견한 문제 텍스트 (ok=true면 빈 문자열)" },
  },
};

// 자가 비평 스키마 — 1차 결과를 브리프 대비 검토해 개선 프롬프트 산출
const REFINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "critique", "image_prompt"],
  properties: {
    verdict: { type: "string", enum: ["keep", "improve"], description: "keep = 1차 결과 충분, improve = 재생성 필요" },
    critique: { type: "string", description: "한국어 비평 2~3문장: 무엇이 약하고 무엇을 고쳐야 하는지" },
    image_prompt: { type: "string", description: "개선된 영문 이미지 프롬프트 (keep이면 원본 그대로)" },
  },
};

// 시안 1건 생성: 프롬프트·제작의도 구성(Claude) → 라이트/다크 이미지 2장(선택 엔진) → Storage 저장
export async function POST(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { sessionId } = await params;
  const { direction: bodyDirection, engine: bodyEngine, prompt_override, options, variant_of, refine } = (await req.json().catch(() => ({}))) as {
    direction?: string;
    engine?: ImageEngine;
    prompt_override?: string;
    options?: { logo_type?: string; color_hint?: string; extra?: string; geometry?: string };
    variant_of?: string; // 기존 시안 id — 지정 시 해당 시안의 미세 변형을 생성
    refine?: boolean; // 셀프 리파인: 1차 결과를 AI가 비평 → 개선 프롬프트로 1회 재생성
  };
  if (!variant_of && (!bodyDirection || !bodyEngine)) {
    return NextResponse.json({ error: "direction과 engine이 필요합니다." }, { status: 400 });
  }
  const client = db();

  const { data: brief } = await client
    .from("iv_briefs")
    .select("*")
    .or(ownerFilter(sessionId))
    .maybeSingle();
  if (!brief) return NextResponse.json({ error: "브리프를 먼저 생성하세요." }, { status: 400 });

  const { data: selectedRefs } = await client
    .from("iv_references")
    .select("id, brand_name, summary, note, image_url, image_path")
    .eq("brief_id", brief.id)
    .eq("selected", true);
  if (!selectedRefs?.length) {
    return NextResponse.json({ error: "레퍼런스를 1개 이상 선택하세요." }, { status: 400 });
  }

  // 애셋 프로젝트: 원본 로고 애셋을 모든 생성의 비전 입력으로 첨부해 아이덴티티를 유지한다
  let project: { brand_name: string; goal: string | null; key_colors: string[]; asset_paths: string[] } | null = null;
  const projectImages: string[] = [];
  if (brief.project_id) {
    const { data: p } = await client
      .from("iv_projects")
      .select("brand_name, goal, key_colors, asset_paths")
      .eq("id", brief.project_id)
      .maybeSingle();
    project = p ?? null;
    for (const path of (p?.asset_paths ?? []).slice(0, 2)) {
      const { data: img } = await client.storage.from("iv-concepts").download(path);
      if (img) projectImages.push(Buffer.from(await img.arrayBuffer()).toString("base64"));
    }
  }
  const projectLines = project
    ? `\n## 원본 브랜드 애셋 (첨부 이미지의 앞 ${projectImages.length}장 = 원본 로고)
- 브랜드명: ${project.brand_name}
- 프로젝트 목표: ${project.goal ?? "(미기재)"}
- 키컬러(반드시 유지): ${(project.key_colors ?? []).join(", ") || "원본 로고에서 추출해 유지"}
- 이 작업은 기존 브랜드의 "베리에이션/응용"이다. 원본 로고의 형태 언어와 키컬러를 유지하고, 새 아이덴티티 창작은 금지.`
    : "";

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
  const GEOMETRY_RULES: Record<string, string> = {
    golden:
      "- 비례 체계: 황금비(1:1.618) 기반 기하 구성 — 주요 요소의 크기 관계·간격·분할을 황금비 수열로 설계하고, 광학 보정(시각적 무게 균형)을 포함할 것. 프롬프트에 'golden ratio geometric construction' 지시를 명시할 것",
    grid: "- 비례 체계: 정수비 그리드 기반 기하 구성 — 일관된 모듈 단위(1:2:3:4)와 통일된 코너 반경으로 설계할 것. 프롬프트에 'consistent modular grid construction' 지시를 명시할 것",
  };
  const optionLines = [
    options?.logo_type && `- 로고 유형: ${options.logo_type} 중심으로 구성할 것`,
    options?.color_hint && `- 컬러 지시: ${options.color_hint} — 팔레트에 반드시 반영할 것`,
    options?.geometry && GEOMETRY_RULES[options.geometry],
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
      prompt: `## 기준 시안 (첨부 이미지의 마지막 1장)
- 원 이미지 프롬프트: ${variantSource.prompt}
- 원 제작 의도: ${variantSource.rationale ?? "(없음)"}
${projectLines}
${optionLines.length ? `\n## 관리자 옵션 (최우선 반영)\n${optionLines.join("\n")}` : ""}

기준 시안의 핵심을 유지한 채 디테일만 달리한 변형의 이미지 프롬프트·제작 의도·팔레트를 JSON으로 작성하라.`,
      images: [...projectImages, ...srcImages],
      schema: COMPOSE_SCHEMA,
      effort: "high",
    });
    composed = extractJSON(text);
  } else {
    // 발전 기반 이미지 다운로드가 실패했다면 refine 모드를 포기한다 —
    // 프롬프트가 "마지막 첨부 = 선정 시안"이라 주장하는데 실제로는 다른 이미지가 되는 오인 방지
    const refineMode = round > 1 && baseConcept && baseImages.length > 0;

    // 선택 레퍼런스의 실제 이미지를 비전 입력으로 — 스냅샷(Storage) 우선, 없으면 외부 fetch
    const refImages = (
      await Promise.all(
        (selectedRefs as { image_url?: string | null; image_path?: string | null }[])
          .slice(0, 3)
          .map(async (r) => {
            if (r.image_path) {
              const { data } = await client.storage.from("iv-concepts").download(r.image_path);
              if (data) {
                const ext = r.image_path.split(".").pop();
                const mt = (ext === "jpg" ? "image/jpeg" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/png") as VisionImage["media_type"];
                return { data: Buffer.from(await data.arrayBuffer()).toString("base64"), media_type: mt };
              }
            }
            return fetchRefImage(r.image_url ?? "");
          })
      )
    ).filter((x): x is VisionImage => x !== null);

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
${projectLines}

## 선택된 레퍼런스 (${selectedRefs.length}개)
${selectedRefs.map((r) => `- ${r.brand_name}: ${r.summary}${r.note ? ` / 관리자 메모: ${r.note}` : ""}`).join("\n")}
${refImages.length ? `※ 첨부 이미지 중 ${refImages.length}장은 위 레퍼런스의 실제 이미지다 (순서: ${projectImages.length ? `원본 애셋 ${projectImages.length}장 다음, ` : "첫 번째부터, "}발전 기반 시안보다 앞). 조형 언어·구성·무드를 직접 관찰해 분석하고, 베끼지 말고 원리만 가져와라.` : ""}
${
  refineMode
    ? `\n## 발전 기반 (첨부 이미지의 마지막 1장 = ${round - 1}회차 선정 시안)
- 원 제작 의도: ${baseConcept!.rationale ?? "(없음)"}
${baseEvalSummary ? `- 평가 요약: ${baseEvalSummary}` : ""}
${roundFeedback ? `- ${round - 1}회차 피드백 (최우선 반영): ${roundFeedback}` : ""}`
    : ""
}
${optionLines.length ? `\n## 관리자 옵션 (최우선 반영)\n${optionLines.join("\n")}` : ""}
${priorPrompts.length ? `\n## 이번 회차에 이미 시도한 접근 (이것들과 다르게)\n${priorPrompts.map((p, i) => `${i + 1}. ${p.slice(0, 160)}`).join("\n")}` : ""}

위 재료로 로고 컨셉 시안의 이미지 프롬프트·제작 의도·팔레트를 JSON으로 작성하라.`,
      images: [...projectImages, ...refImages, ...baseImages],
      schema: COMPOSE_SCHEMA,
      effort: "high",
    });
    composed = extractJSON(text);
  }

  // 2) 라이트 생성 → 텍스트 검사 → (셀프 리파인) → 확정된 라이트에서 다크 파생
  const lightSuffix = `\n\nPresented on a clean white background, light mode version. Professional brand identity presentation, high quality, centered composition.`;
  const darkSuffix = `\n\nPresented on a very dark charcoal background (#0a0c02), dark mode version with adjusted colors for dark background legibility. Professional brand identity presentation, high quality, centered composition.`;

  // 실사용 모델 추적 (Gemini pro→flash 폴백 여부 기록)
  const modelsUsed = new Set<string>();
  const genImg = async (p: string, input?: Buffer) => {
    const r = await generateImageEx(engine, p, input);
    modelsUsed.add(r.model);
    return r.buf;
  };

  let light = await genImg(`${composed.image_prompt}${lightSuffix}`);

  // 2.2) 브랜드명·텍스트 오탈자 검사 (저비용) — 문제가 보이면 1회 재생성
  if (!prompt_override) {
    try {
      const check = extractJSON<{ ok: boolean; found: string }>(
        await claudeCall({
          system:
            "너는 로고 이미지 텍스트 검수자다. 첨부 이미지에 보이는 텍스트가 철자 오류·글자 깨짐·의미 없는 문자열 없이 깨끗한지만 판정한다. 텍스트가 아예 없으면 ok=true.",
          prompt: `사용된 프롬프트 발췌 (의도된 표기 참고용): ${composed.image_prompt.slice(0, 300)}\n\n이미지 속 텍스트를 검사해 JSON으로 답하라.`,
          images: [light.toString("base64")],
          schema: TEXT_CHECK_SCHEMA,
          effort: "low",
          maxTokens: 2000,
        })
      );
      if (!check.ok) {
        light = await genImg(
          `${composed.image_prompt}${lightSuffix}\n\nCRITICAL: Render all text with EXACT correct spelling and clean letterforms. No gibberish or broken glyphs. Previously observed problem text: "${(check.found ?? "").slice(0, 80)}".`
        );
      }
    } catch {
      /* 검사 실패 시 1차 결과 사용 */
    }
  }

  // 2.5) 셀프 리파인: 1차 결과를 브리프 대비 자가 비평 → 개선 필요 시 프롬프트 수정 후 1회 재생성
  if (refine && !prompt_override) {
    try {
      const critique = extractJSON<{ verdict: "keep" | "improve"; critique: string; image_prompt: string }>(
        await claudeCall({
          system: `너는 까다로운 브랜드 아트 디렉터다. 첨부 이미지는 방금 생성된 로고 시안 1차 결과(라이트 버전)다.
브리프와 제작 의도에 비추어 이 시안을 냉정하게 비평하고, 프롬프트를 어떻게 고치면 나아질지 판단하라.
verdict 기준: 조형 완성도·브랜드명 표기 정확성·브리프 적합성이 모두 준수하면 keep, 하나라도 약하면 improve.
improve일 때 image_prompt는 원본 프롬프트의 좋은 점은 유지하면서 지적 사항만 정밀하게 고친 완전한 프롬프트여야 한다 (배경 지정 문구는 넣지 말 것).`,
          prompt: `## 브리프
포지셔닝: ${brief.content?.positioning}
키워드: ${(brief.content?.keywords ?? []).join(", ")}
피할 것: ${(brief.content?.anti ?? []).join(", ")}

## 이 시안의 제작 의도
${composed.rationale}

## 사용된 프롬프트
${composed.image_prompt}

첨부된 1차 결과를 비평하고 JSON으로 답하라.`,
          images: [light.toString("base64")],
          schema: REFINE_SCHEMA,
          effort: "medium",
        })
      );
      if (critique.verdict === "improve" && critique.image_prompt?.trim()) {
        composed.image_prompt = critique.image_prompt.trim();
        composed.rationale = `${composed.rationale ?? ""}\n\n[셀프 리파인] ${critique.critique}`;
        light = await genImg(`${composed.image_prompt}${lightSuffix}`);
      }
    } catch {
      /* 리파인 실패 시 1차 결과 그대로 사용 */
    }
  }

  // 2.9) 다크는 확정된 라이트 이미지에서 파생 — 두 버전의 조형 일관성 보장
  let dark: Buffer;
  try {
    dark = await genImg(
      `Convert this exact logo design to a dark mode version: place it on a very dark charcoal background (#0a0c02), adjusting colors only as needed for legibility on dark. Keep the logo's shape, composition and proportions IDENTICAL to the input. Professional brand identity presentation, centered composition.`,
      light
    );
  } catch {
    // 파생 실패 시 기존 방식(독립 생성)으로 폴백
    dark = await genImg(`${composed.image_prompt}${darkSuffix}`);
  }

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
      .upload(path, buf, { contentType: sniffMediaType(buf), upsert: true });
    if (error) return NextResponse.json({ error: `이미지 저장 실패: ${error.message}` }, { status: 500 });
  }

  const { data, error } = await client
    .from("iv_concepts")
    .insert({
      brief_id: brief.id,
      direction,
      engine,
      gen_model: [...modelsUsed].join("+") || null,
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
