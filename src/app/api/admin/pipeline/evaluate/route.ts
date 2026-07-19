import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import { claudeCall, extractJSON } from "@/lib/ai";
import { DEFAULT_CRITERIA } from "@/lib/criteria";

export const maxDuration = 300;

// 기준명을 enum으로 강제 — AI가 기준명을 다르게 쓰면 가중치 0으로 총점이 조용히 왜곡되는 것 방지
function makeEvalSchema(criteriaNames: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["scores", "summary"],
    properties: {
      scores: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["criterion", "score", "reason"],
          properties: {
            criterion: { type: "string", enum: criteriaNames },
            score: { type: "integer", minimum: 0, maximum: 10 },
            reason: { type: "string", description: "채점 근거 (한국어 1~2문장, 구체적으로)" },
          },
        },
      },
      summary: { type: "string", description: "종합 평가 (한국어): 강점, 약점·리스크, 어떤 경우에 이 안을 선택할지 조건부 추천" },
    },
  };
}

// 시안 1건 AI 평가: 브리프 + 라이트/다크 이미지(비전) → 기준별 채점 저장
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { concept_id } = await req.json().catch(() => ({}));
  if (!concept_id) return NextResponse.json({ error: "concept_id가 필요합니다." }, { status: 400 });
  const client = db();

  const { data: concept } = await client.from("iv_concepts").select("*").eq("id", concept_id).single();
  if (!concept) return NextResponse.json({ error: "시안을 찾을 수 없습니다." }, { status: 404 });
  const { data: brief } = await client.from("iv_briefs").select("content, criteria").eq("id", concept.brief_id).single();

  // 브리프별 커스텀 기준 (없으면 기본 6개)
  const rawCriteria = (brief?.criteria ?? null) as { criterion: string; weight: number; hint?: string }[] | null;
  const CRITERIA = rawCriteria?.length ? rawCriteria : DEFAULT_CRITERIA;

  // 라이트/다크 두 장 모두 비전 입력 (다크 모드 가독성도 평가에 반영)
  const images: string[] = [];
  for (const path of [concept.image_light_path, concept.image_dark_path]) {
    if (!path) continue;
    const { data: file } = await client.storage.from("iv-concepts").download(path);
    if (file) images.push(Buffer.from(await file.arrayBuffer()).toString("base64"));
  }
  if (!images.length) return NextResponse.json({ error: "시안 이미지를 불러오지 못했습니다." }, { status: 500 });

  let text: string;
  try {
    text = await claudeCall({
      system: `너는 독립 브랜드 리뷰 보드다. 시안 제작에 관여하지 않은 제3자 시점으로, 주어진 기준에 따라 공정하게 채점한다.
규칙:
- 각 기준을 0~10점으로 채점하고, 점수마다 이미지에서 관찰한 구체적 근거를 쓴다. 총점만으로 결론 내리지 않는다.
- 첫 번째 이미지는 라이트 모드, 두 번째는 다크 모드 버전이다. 가독성 평가에 둘 다 반영한다.
- 블라인드 평가: 제작 의도·설명은 주어지지 않는다. 오직 이미지에서 관찰한 것과 브리프만으로 판단한다.
- 약점과 리스크를 감추지 않는다. 상표 유사 가능성은 "확인 필요" 수준으로만 지적한다 (법률 자문 아님).
- summary는 조건부 추천 형식으로 끝낸다: "X를 우선한다면 이 안이 적합/부적합".`,
    prompt: `## 브리프
포지셔닝: ${brief?.content?.positioning ?? "(없음)"}
키워드: ${(brief?.content?.keywords ?? []).join(", ")}
피할 것: ${(brief?.content?.anti ?? []).join(", ")}

## 이 시안
방향: ${concept.direction} (${concept.round ?? 1}회차)

## 평가 기준 (기준명은 정확히 이대로 사용)
${CRITERIA.map((c) => `- ${c.criterion} (가중치 ${c.weight})${c.hint ? `: ${c.hint}` : ""}`).join("\n")}

이미지를 관찰하고 기준별로 채점해 JSON으로 출력하라.`,
      images,
      schema: makeEvalSchema(CRITERIA.map((c) => c.criterion)),
      effort: "medium",
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "평가 실패" }, { status: 500 });
  }

  const parsed = extractJSON<{ scores: { criterion: string; score: number; reason: string }[]; summary: string }>(text);

  // 가중 총점 계산 (100점 만점): Σ(score/10 × weight)
  const withWeights = parsed.scores.map((s) => {
    const def = CRITERIA.find((c) => c.criterion === s.criterion);
    return { ...s, weight: def?.weight ?? 0 };
  });
  const total = Math.round(withWeights.reduce((sum, s) => sum + (s.score / 10) * s.weight, 0) * 10) / 10;

  const { data, error } = await client
    .from("iv_evaluations")
    .insert({ concept_id, scores: withWeights, total, summary: parsed.summary })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ evaluation: data });
}
