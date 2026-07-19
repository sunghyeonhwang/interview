import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import { claudeCall, extractJSON } from "@/lib/ai";
import { ownerFilter, type DesignProject } from "@/lib/pipeline";
import type { Question } from "@/lib/types";

export const maxDuration = 300;

type Params = { params: Promise<{ sessionId: string }> };

const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["positioning", "keywords", "anti", "directions"],
  properties: {
    positioning: { type: "string", description: "핵심 포지셔닝 서술 (한국어, 2~3문장)" },
    keywords: { type: "array", items: { type: "string" }, description: "무드/가치 키워드" },
    anti: { type: "array", items: { type: "string" }, description: "피해야 할 방향·인상" },
    directions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "concept", "mood", "search_queries"],
        properties: {
          name: { type: "string", description: "방향 이름 (한국어)" },
          concept: { type: "string", description: "한 단락 컨셉 설명 (한국어)" },
          mood: { type: "array", items: { type: "string" } },
          search_queries: {
            type: "array",
            items: { type: "string" },
            description: "실제 브랜드 벤치마크를 찾기 위한 웹 검색 쿼리 (영어/일본어/한국어 혼용, 수상·사례 중심)",
          },
        },
      },
    },
  },
};

// 인터뷰 답변(읽기 전용) 또는 프로젝트 애셋 → 디자인 브리프 생성
export async function POST(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { sessionId } = await params;
  const client = db();

  // ── 인터뷰 데이터 조회 (SELECT만 — 절대 수정하지 않음) ──
  const { data: session } = await client
    .from("iv_sessions")
    .select("id, respondent_name, status, questionnaire_id, iv_questionnaires(title)")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) {
    // 세션이 아니면 애셋 프로젝트 모드로 시도
    const { data: project } = await client.from("iv_projects").select("*").eq("id", sessionId).maybeSingle();
    if (!project) return NextResponse.json({ error: "세션/프로젝트를 찾을 수 없습니다." }, { status: 404 });
    return projectBrief(client, project);
  }
  if (session.status !== "submitted") {
    return NextResponse.json({ error: "제출 완료된 인터뷰에서만 기획을 생성할 수 있습니다." }, { status: 400 });
  }

  const { data: sections } = await client
    .from("iv_sections")
    .select("*, iv_questions(*)")
    .eq("questionnaire_id", session.questionnaire_id)
    .order("order");
  const { data: answers } = await client
    .from("iv_answers")
    .select("question_id, value")
    .eq("session_id", sessionId);
  const answerMap = new Map((answers ?? []).map((a) => [a.question_id, a.value]));

  const qTitle = (session.iv_questionnaires as unknown as { title: string } | null)?.title ?? "";
  const lines: string[] = [`# 인터뷰: ${qTitle} — ${session.respondent_name}`];
  for (const s of sections ?? []) {
    lines.push(`\n## ${s.title}`);
    for (const q of ((s.iv_questions ?? []) as Question[]).sort((a, b) => a.order - b.order)) {
      const v = answerMap.get(q.id);
      if (v == null || v === "") continue;
      lines.push(`- Q: ${q.prompt}\n  A: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
    }
  }

  // 과거 재시작 기각 사유 — 새 브리프에 반드시 반영
  const { data: existing } = await client
    .from("iv_briefs")
    .select("id, reset_notes")
    .eq("session_id", sessionId)
    .maybeSingle();
  const resetNotes = ((existing?.reset_notes ?? []) as { feedback: string }[]).map((n) => n.feedback);
  const resetSection = resetNotes.length
    ? `\n## 과거 재시작 기각 사유 (최우선 반영 — 같은 실수를 반복하는 방향은 금지)\n${resetNotes.map((f, i) => `${i + 1}. ${f}`).join("\n")}`
    : "";

  // ── Claude로 브리프 생성 ──
  const text = await claudeCall({
    system: `너는 브랜드 전략가다. 대표 인터뷰 답변을 근거로 디자인 브리프를 만든다.
규칙:
- 모든 판단은 인터뷰 답변에 근거해야 하며, 답변에 없는 사실을 지어내지 않는다.
- "과거 재시작 기각 사유"가 있으면 그 문제를 해소하는 방향으로 만들고, anti에도 반영한다.
- directions는 서로 전략적으로 뚜렷이 구분되는 2~3개 방향으로 만든다 (표면적 변형 금지).
  각 방향은 서로 다른 조형 축(모티프 계열 × 구성 방식 × 무드)을 대표해야 하고, name은 결과물이 그려지도록 구체적으로,
  concept에는 대표 모티프 후보 1~2개와 조형 언어(기하/유기, 선/면, 대칭/비대칭 등)를 포함한다.
- search_queries는 각 방향당 2~3개. 실제 브랜드/로고 벤치마크 사례를 찾는 쿼리로:
  디자인 어워드("good design award", "red dot", "iF design"), 큐레이션 매체(site:behance.net, site:bpando.org, site:underconsideration.com) 활용을 우선하고,
  업종·지역·스타일 키워드를 조합한다. Pinterest는 절대 포함하지 않는다.
- anti에는 인터뷰의 안티 레퍼런스 답변을 반드시 반영한다.`,
    prompt: `다음 인터뷰를 분석해 브리프를 JSON으로 작성하라.${resetSection}\n\n${lines.join("\n")}`,
    schema: BRIEF_SCHEMA,
    effort: "medium",
  });

  const content = extractJSON<Record<string, unknown>>(text);

  // upsert: 기존 브리프가 있으면 교체 (레퍼런스·시안은 CASCADE 유지되지 않도록 기존 brief 재사용)
  if (existing) {
    const { data, error } = await client
      .from("iv_briefs")
      .update({ content, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ brief: data });
  }
  const { data, error } = await client
    .from("iv_briefs")
    .insert({ session_id: sessionId, content })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ brief: data });
}

// 애셋 프로젝트 모드: 브랜드 자산(로고 이미지 비전 입력)·키컬러·목표 → 베리에이션 브리프
async function projectBrief(client: ReturnType<typeof db>, project: DesignProject) {
  const images: string[] = [];
  for (const path of (project.asset_paths ?? []).slice(0, 3)) {
    const { data: file } = await client.storage.from("iv-concepts").download(path);
    if (file) images.push(Buffer.from(await file.arrayBuffer()).toString("base64"));
  }

  // 과거 재시작 기각 사유 반영
  const { data: existing } = await client
    .from("iv_briefs")
    .select("id, reset_notes")
    .eq("project_id", project.id)
    .maybeSingle();
  const resetNotes = ((existing?.reset_notes ?? []) as { feedback: string }[]).map((n) => n.feedback);
  const resetSection = resetNotes.length
    ? `\n## 과거 재시작 기각 사유 (최우선 반영 — 같은 실수를 반복하는 방향은 금지)\n${resetNotes.map((f, i) => `${i + 1}. ${f}`).join("\n")}`
    : "";

  const text = await claudeCall({
    system: `너는 브랜드 전략가다. "이미 확립된 브랜드"의 기존 자산을 응용·확장하는 디자인 브리프를 만든다.
지금은 신규 아이덴티티 개발이 아니라, 첨부된 원본 로고 애셋과 키컬러를 기반으로 한 베리에이션/응용 작업이다.
규칙:
- positioning에는 이 프로젝트의 목표(어떤 산출물이 왜 필요한지)를 요약한다.
- directions는 원본 아이덴티티(형태 언어·키컬러)를 유지하면서도 서로 뚜렷이 다른 응용 방향 2~3개로 만든다.
  (예: 심볼 단순화/모노그램화, 그래픽 모티프 확장, 엠블럼·배지 응용 등 — 프로젝트 목표에 맞게)
  각 방향의 concept에는 첨부된 원본 로고에서 관찰한 구체적 조형 요소(어떤 형태·선·비례를 가져와 어떻게 응용할지)를 명시한다.
- anti에는 "원본 아이덴티티를 훼손하는 것"(키컬러 무시, 형태 언어 이탈 등)을 반드시 포함한다.
- search_queries는 각 방향당 2~3개. 유사한 브랜드 리프레시/베리에이션/서브브랜드 사례를 찾는 쿼리로,
  디자인 어워드·큐레이션 매체(site:behance.net, site:bpando.org)를 활용한다. Pinterest는 절대 포함하지 않는다.`,
    prompt: `## 프로젝트
- 프로젝트명: ${project.title}
- 브랜드명: ${project.brand_name}
- 목표: ${project.goal ?? "(미기재)"}
- 키컬러: ${(project.key_colors ?? []).join(", ") || "(첨부 이미지에서 추출)"}
${images.length ? `- 첨부 이미지: 원본 로고 애셋 ${images.length}건` : "- 첨부 애셋 없음 — 브랜드명과 목표만으로 작성"}

${resetSection}
위 브랜드의 기존 자산을 응용하는 디자인 브리프를 JSON으로 작성하라.`,
    images,
    schema: BRIEF_SCHEMA,
    effort: "medium",
  });
  const content = extractJSON<Record<string, unknown>>(text);

  if (existing) {
    const { data, error } = await client
      .from("iv_briefs")
      .update({ content, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ brief: data });
  }
  const { data, error } = await client
    .from("iv_briefs")
    .insert({ project_id: project.id, content })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ brief: data });
}

// 관리자가 브리프 내용·평가 기준 직접 수정
export async function PATCH(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { sessionId } = await params;
  const { content, criteria } = await req.json().catch(() => ({}));
  if (!content && criteria === undefined) {
    return NextResponse.json({ error: "content 또는 criteria가 필요합니다." }, { status: 400 });
  }
  if (criteria !== undefined && criteria !== null) {
    const list = criteria as { criterion?: string; weight?: number }[];
    if (!Array.isArray(list) || !list.length || list.some((c) => !c.criterion?.trim() || !(Number(c.weight) > 0))) {
      return NextResponse.json({ error: "기준명과 양수 가중치를 모두 입력하세요." }, { status: 400 });
    }
    const sum = list.reduce((s, c) => s + Number(c.weight), 0);
    if (sum !== 100) {
      return NextResponse.json({ error: `가중치 합이 100이어야 합니다 (현재 ${sum}).` }, { status: 400 });
    }
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (content) patch.content = content;
  if (criteria !== undefined) patch.criteria = criteria; // null이면 기본 기준으로 복원
  const { data, error } = await db()
    .from("iv_briefs")
    .update(patch)
    .or(ownerFilter(sessionId))
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ brief: data });
}
