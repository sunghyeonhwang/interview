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

  const text = await claudeCall({
    system: `너는 벡터 로고 전문가다. 시안 이미지(래스터)를 분석해, 그 핵심 조형을 깨끗하고 시맨틱한 SVG 코드로 재작성한다.
규칙:
- 이미지를 픽셀 단위로 트레이싱하지 말고, 조형 언어(형태·비례·색)를 파악해 단순하고 확장 가능한 벡터로 재구성한다.
- viewBox 사용, 불필요한 그룹·필터 금지, 색상은 팔레트 HEX로 명시.
- 텍스트(브랜드명)가 있으면 <text> 대신 단순한 형태로 근사하거나 생략 가능 여부를 판단해 로고 마크 중심으로.
- 출력은 오직 <svg ...>...</svg> 코드만. 설명 금지.`,
    prompt: `이 시안의 제작 의도: ${concept.rationale ?? "(없음)"}
팔레트: ${JSON.stringify(concept.palette ?? [])}

이 시안을 SVG 로고로 재작성하라.`,
    images: [base64],
    maxTokens: 32000,
  });

  const match = text.match(/<svg[\s\S]*<\/svg>/i);
  if (!match) return NextResponse.json({ error: "SVG 생성에 실패했습니다. 다시 시도해주세요." }, { status: 502 });
  const svg = match[0];

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
