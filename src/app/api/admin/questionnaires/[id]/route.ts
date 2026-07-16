import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import type { Section, Question } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

// 질문지 전체 구조 조회 (섹션 + 문항 포함)
export async function GET(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const client = db();
  const { data: q, error } = await client
    .from("iv_questionnaires")
    .select("*, iv_sections(*, iv_questions(*))")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const sections = (q.iv_sections ?? [])
    .sort((a: Section, b: Section) => a.order - b.order)
    .map((s: Section & { iv_questions: Question[] }) => ({
      id: s.id,
      title: s.title,
      guide: s.guide,
      order: s.order,
      questions: (s.iv_questions ?? []).sort((a, b) => a.order - b.order),
    }));
  return NextResponse.json({
    questionnaire: { id: q.id, title: q.title, description: q.description, created_at: q.created_at, sections },
  });
}

// 질문지 전체 구조 저장: 기존 id는 upsert, 목록에서 빠진 id는 삭제
export async function PUT(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body?.title || !Array.isArray(body.sections)) {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }
  const client = db();

  const { error: qErr } = await client
    .from("iv_questionnaires")
    .update({ title: body.title, description: body.description ?? null, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

  // 현재 DB의 섹션/문항 id 수집
  const { data: existing } = await client
    .from("iv_sections")
    .select("id, iv_questions(id)")
    .eq("questionnaire_id", id);
  const dbSectionIds = new Set((existing ?? []).map((s) => s.id));
  const dbQuestionIds = new Set((existing ?? []).flatMap((s) => (s.iv_questions ?? []).map((x: { id: string }) => x.id)));

  const keptSectionIds = new Set<string>();
  const keptQuestionIds = new Set<string>();

  for (let si = 0; si < body.sections.length; si++) {
    const s = body.sections[si];
    let sectionId: string = s.id;
    const sectionRow = { questionnaire_id: id, title: s.title || "무제 섹션", guide: s.guide ?? null, order: si };
    if (s.id && dbSectionIds.has(s.id)) {
      const { error } = await client.from("iv_sections").update(sectionRow).eq("id", s.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      const { data, error } = await client.from("iv_sections").insert(sectionRow).select("id").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      sectionId = data.id;
    }
    keptSectionIds.add(sectionId);

    for (let qi = 0; qi < (s.questions ?? []).length; qi++) {
      const qq = s.questions[qi];
      const qRow = {
        section_id: sectionId,
        type: qq.type,
        prompt: qq.prompt || "",
        guide: qq.guide ?? null,
        options: qq.options ?? null,
        required: !!qq.required,
        order: qi,
      };
      if (qq.id && dbQuestionIds.has(qq.id)) {
        const { error } = await client.from("iv_questions").update(qRow).eq("id", qq.id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        keptQuestionIds.add(qq.id);
      } else {
        const { data, error } = await client.from("iv_questions").insert(qRow).select("id").single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        keptQuestionIds.add(data.id);
      }
    }
  }

  // 빠진 항목 삭제 (답변은 FK cascade로 함께 삭제됨 — 편집기에서 경고)
  const delQ = [...dbQuestionIds].filter((x) => !keptQuestionIds.has(x));
  const delS = [...dbSectionIds].filter((x) => !keptSectionIds.has(x));
  if (delQ.length) await client.from("iv_questions").delete().in("id", delQ);
  if (delS.length) await client.from("iv_sections").delete().in("id", delS);

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const { error } = await db().from("iv_questionnaires").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
