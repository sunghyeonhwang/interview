import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import type { Question, Section } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

// 질문지 복제: 섹션·문항까지 통째로 복사 (세션·응답은 복사하지 않음)
export async function POST(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { id } = await params;
  const client = db();

  const { data: src, error: srcErr } = await client
    .from("iv_questionnaires")
    .select("title, description, iv_sections(*, iv_questions(*))")
    .eq("id", id)
    .single();
  if (srcErr || !src) return NextResponse.json({ error: "원본 질문지를 찾을 수 없습니다." }, { status: 404 });

  const { data: copy, error: copyErr } = await client
    .from("iv_questionnaires")
    .insert({ title: `${src.title} (복사본)`, description: src.description })
    .select("id")
    .single();
  if (copyErr) return NextResponse.json({ error: copyErr.message }, { status: 500 });

  const sections = (src.iv_sections ?? []).sort((a: Section, b: Section) => a.order - b.order);
  for (const s of sections as (Section & { iv_questions: Question[] })[]) {
    const { data: newSection, error: sErr } = await client
      .from("iv_sections")
      .insert({ questionnaire_id: copy.id, title: s.title, guide: s.guide, order: s.order })
      .select("id")
      .single();
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

    const questions = (s.iv_questions ?? []).sort((a, b) => a.order - b.order);
    if (questions.length) {
      const { error: qErr } = await client.from("iv_questions").insert(
        questions.map((q) => ({
          section_id: newSection.id,
          type: q.type,
          prompt: q.prompt,
          guide: q.guide,
          options: q.options,
          required: q.required,
          order: q.order,
        }))
      );
      if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ id: copy.id });
}
