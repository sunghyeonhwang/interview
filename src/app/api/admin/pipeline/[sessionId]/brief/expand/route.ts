import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import { claudeCall, extractJSON } from "@/lib/ai";
import { ownerFilter } from "@/lib/pipeline";

export const maxDuration = 300;

type Params = { params: Promise<{ sessionId: string }> };

const EXPAND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["directions"],
  properties: {
    directions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "concept", "mood", "search_queries"],
        properties: {
          name: { type: "string", description: "방향 이름 (한국어, 기존 방향과 겹치지 않게)" },
          concept: { type: "string", description: "한 단락 컨셉 설명 (한국어) — 왜 이 방향이 대안이 되는지 포함" },
          mood: { type: "array", items: { type: "string" } },
          search_queries: {
            type: "array",
            items: { type: "string" },
            description: "벤치마크 검색 쿼리 2~3개 (어워드·큐레이션 매체 활용, Pinterest 금지)",
          },
        },
      },
    },
  },
};

// 브리프에 방향 추가: 역제안(counter — 기존 해석과 의도적으로 다른 대안) 또는 아이디어 확장(seed)
export async function POST(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { sessionId } = await params;
  const { mode, note } = (await req.json().catch(() => ({}))) as { mode?: "counter" | "seed"; note?: string };
  if (mode !== "counter" && mode !== "seed") {
    return NextResponse.json({ error: "mode는 counter 또는 seed여야 합니다." }, { status: 400 });
  }
  if (mode === "seed" && !note?.trim()) {
    return NextResponse.json({ error: "확장할 아이디어를 입력하세요." }, { status: 400 });
  }
  const client = db();

  const { data: brief } = await client.from("iv_briefs").select("*").or(ownerFilter(sessionId)).maybeSingle();
  if (!brief) return NextResponse.json({ error: "브리프를 먼저 생성하세요." }, { status: 400 });

  const existing = (brief.content?.directions ?? []) as { name: string; concept: string }[];

  // 지금까지의 시안·평가 맥락 (역제안의 근거) — 최근 6건
  const { data: concepts } = await client
    .from("iv_concepts")
    .select("id, direction, rationale")
    .eq("brief_id", brief.id)
    .order("created_at", { ascending: false })
    .limit(6);
  const conceptIds = (concepts ?? []).map((c) => c.id);
  const { data: evals } = conceptIds.length
    ? await client
        .from("iv_evaluations")
        .select("concept_id, total, summary")
        .in("concept_id", conceptIds)
        .order("created_at", { ascending: false })
    : { data: [] };
  const evalOf = (cid: string) => (evals ?? []).find((e) => e.concept_id === cid);
  const attemptLines = (concepts ?? []).map((c) => {
    const e = evalOf(c.id);
    return `- [${c.direction}] ${((c.rationale ?? "") as string).slice(0, 120)}${e ? ` → 평가 ${e.total}점: ${(e.summary ?? "").slice(0, 100)}` : ""}`;
  });

  const text = await claudeCall({
    system:
      mode === "counter"
        ? `너는 브랜드 크리에이티브 디렉터다. 기존 브리프의 해석과 "의도적으로 다른 지점"의 대안 방향(counter-proposal)을 제안한다.
규칙:
- 브랜드의 사실(업종, 이름, 핵심 서비스, 피할 것의 사실관계)은 유지한다. 그러나 무드·조형 전략·톤은 기존 방향들과 뚜렷이 반대이거나 전혀 다른 축을 택한다.
- 기존 방향과 시안 평가에서 드러난 한계를 근거로, "인터뷰 답변을 문자 그대로 따르면 놓치는 가능성"을 제시한다.
- 관리자 코멘트가 있으면 그것이 지적하는 문제를 최우선으로 해소하는 방향으로 만든다.
- 방향은 1~2개만, 이름은 기존과 겹치지 않게. search_queries는 어워드·큐레이션 매체(site:behance.net, site:bpando.org) 활용, Pinterest 금지.`
        : `너는 브랜드 크리에이티브 디렉터다. 관리자의 한 줄 아이디어를 완전한 디자인 방향으로 확장한다.
규칙:
- 아이디어의 의도를 존중하면서 브리프의 브랜드 사실(업종, 이름, 핵심 서비스)과 연결한다.
- 방향은 1개만, 이름은 기존 방향과 겹치지 않게. concept에는 이 아이디어가 브랜드에 어떻게 작동하는지 쓴다.
- search_queries는 어워드·큐레이션 매체(site:behance.net, site:bpando.org) 활용, Pinterest 금지.`,
    prompt: `## 현재 브리프
포지셔닝: ${brief.content?.positioning ?? ""}
키워드: ${(brief.content?.keywords ?? []).join(", ")}
피할 것: ${(brief.content?.anti ?? []).join(", ")}

## 기존 방향 (이것들과 뚜렷이 다르게)
${existing.map((d) => `- ${d.name}: ${d.concept.slice(0, 100)}`).join("\n") || "(없음)"}
${attemptLines.length ? `\n## 지금까지의 시안·평가\n${attemptLines.join("\n")}` : ""}
${
  mode === "counter"
    ? `\n## 관리자 코멘트 (현재 결과가 맞지 않는 이유)\n${note?.trim() || "(없음 — 시안·평가 맥락에서 스스로 판단하라)"}`
    : `\n## 확장할 아이디어\n${note!.trim()}`
}

새 방향을 JSON으로 작성하라.`,
    schema: EXPAND_SCHEMA,
    effort: "medium",
  });

  const parsed = extractJSON<{ directions: { name: string; concept: string; mood: string[]; search_queries: string[] }[] }>(text);
  const existingNames = new Set(existing.map((d) => d.name));
  const added = parsed.directions
    .filter((d) => d.name.trim() && !existingNames.has(d.name))
    .slice(0, 2)
    .map((d) => ({ ...d, origin: mode }));
  if (!added.length) return NextResponse.json({ error: "새 방향을 만들지 못했습니다. 다시 시도해주세요." }, { status: 500 });

  const content = { ...brief.content, directions: [...(brief.content?.directions ?? []), ...added] };
  const { data, error } = await client
    .from("iv_briefs")
    .update({ content, updated_at: new Date().toISOString() })
    .eq("id", brief.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ brief: data, added: added.map((d) => d.name) });
}
