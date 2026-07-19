import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import { claudeCall } from "@/lib/ai";

export const maxDuration = 300;

// 선택된 시안 이미지 → Claude 비전 → 깨끗한 SVG 코드 재작성
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { concept_id } = await req.json().catch(() => ({}));
  if (!concept_id) return NextResponse.json({ error: "concept_id가 필요합니다." }, { status: 400 });
  const client = db();

  const { data: concept } = await client.from("iv_concepts").select("*").eq("id", concept_id).single();
  if (!concept) return NextResponse.json({ error: "시안을 찾을 수 없습니다." }, { status: 404 });

  // 라이트 버전 이미지를 비전 입력으로
  const { data: file, error: dlErr } = await client.storage
    .from("iv-concepts")
    .download(concept.image_light_path);
  if (dlErr || !file) return NextResponse.json({ error: "시안 이미지를 불러오지 못했습니다." }, { status: 500 });
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  let text: string;
  try {
    text = await claudeCall({
      system: `너는 벡터 로고 전문가다. 시안 이미지(래스터)를 분석해, 그 핵심 조형을 깨끗하고 시맨틱한 SVG 코드로 재작성한다.
규칙:
- 이미지를 픽셀 단위로 트레이싱하지 말고, 조형 언어(형태·비례·색)를 파악해 단순하고 확장 가능한 벡터로 재구성한다.
- viewBox="0 0 512 512" 기준, 사방 최소 48 단위의 여백(세이프 에어리어)을 남긴다.
- 기본 도형(circle·rect·정돈된 path) 우선, 앵커 포인트 최소화. 좌표·치수는 정수 또는 명확한 비율값으로.
- 광학 보정: 수학적 중앙이 아니라 시각적 중앙·균형에 맞춘다 (삼각형·비대칭 형태는 무게중심 보정).
- 색은 시안 팔레트 HEX만 사용, 단색 면으로 구성. 그라데이션·필터·마스크·blur 금지 (필요하면 단색 면 분할로 근사).
- 원 프롬프트에 비례 체계 지시(golden ratio / modular grid)가 있으면, SVG 좌표·크기·간격을 그 수치 체계로 정확히 구성한다 (예: 황금비면 요소 치수를 1, 1.618, 2.618… 비율로).
- 텍스트(브랜드명)가 있으면 <text> 대신 단순한 형태로 근사하거나 생략 가능 여부를 판단해 로고 마크 중심으로.
- 완성 전 자체 점검: 16px로 줄여도 실루엣이 읽히는가, 면이 겹치거나 새는 곳은 없는가.
- 출력은 오직 <svg ...>...</svg> 코드만. 설명 금지.`,
      prompt: `이 시안의 제작 의도: ${concept.rationale ?? "(없음)"}
팔레트: ${JSON.stringify(concept.palette ?? [])}
원 이미지 프롬프트 발췌: ${((concept.prompt as string) ?? "").slice(0, 400)}

이 시안을 SVG 로고로 재작성하라.`,
      images: [base64],
      maxTokens: 32000,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "SVG 생성 실패" }, { status: 500 });
  }

  const match = text.match(/<svg[\s\S]*<\/svg>/i);
  if (!match) return NextResponse.json({ error: "SVG 생성에 실패했습니다. 다시 시도해주세요." }, { status: 502 });
  let svg = match[0];

  // 렌더 검증 루프: SVG를 실제로 렌더해 원본 시안과 비교 → 불일치하면 1회 수정
  try {
    const { Resvg } = await import("@resvg/resvg-js");
    const render = (code: string) =>
      new Resvg(code, { fitTo: { mode: "width", value: 512 }, background: "#ffffff" }).render().asPng();
    const rendered = Buffer.from(render(svg)).toString("base64");

    const verify = await claudeCall({
      system: `너는 벡터 로고 QA 검수자다. 첫 번째 이미지는 원본 시안, 두 번째는 그것을 재작성한 SVG의 실제 렌더 결과다.
SVG가 원본의 핵심 조형(형태·비례·구성·색)을 충실히 재현했는지 판정하고, 불충실하면 수정된 완전한 SVG 코드를 출력한다.
충실하면 "OK"만 출력하고, 수정이 필요하면 다른 설명 없이 <svg ...>...</svg> 코드만 출력하라.`,
      prompt: `원본 팔레트: ${JSON.stringify(concept.palette ?? [])}\n두 이미지를 비교해 판정하라.`,
      images: [base64, rendered],
      maxTokens: 32000,
      effort: "medium",
    });
    const fixed = verify.match(/<svg[\s\S]*<\/svg>/i);
    if (fixed) {
      try {
        render(fixed[0]); // 수정본이 유효하게 렌더되는지 확인 후 채택
        svg = fixed[0];
      } catch {
        /* 수정본 파싱 실패 시 1차 SVG 유지 */
      }
    }
  } catch {
    /* 렌더 검증 실패 시 1차 SVG 그대로 저장 */
  }

  const { count } = await client
    .from("iv_svgs")
    .select("id", { count: "exact", head: true })
    .eq("concept_id", concept_id);

  const { data, error } = await client
    .from("iv_svgs")
    .insert({ concept_id, version: (count ?? 0) + 1, svg })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ svg: data });
}
