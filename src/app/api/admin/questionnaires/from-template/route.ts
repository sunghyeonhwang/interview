import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import { getTemplate } from "@/lib/templates";

// 템플릿에서 새 질문지 생성: 질문지 → 섹션(order) → 문항(order·options)을
// duplicate 라우트와 동일한 순서·부분 실패 처리 수준으로 삽입한다.
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { templateKey } = await req.json().catch(() => ({}));
  const template = typeof templateKey === "string" ? getTemplate(templateKey) : undefined;
  if (!template) return NextResponse.json({ error: "존재하지 않는 템플릿입니다." }, { status: 400 });

  const client = db();

  const { data: created, error: createErr } = await client
    .from("iv_questionnaires")
    .insert({ title: template.title, description: template.description })
    .select()
    .single();
  if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });

  for (let si = 0; si < template.sections.length; si++) {
    const s = template.sections[si];
    const { data: newSection, error: sErr } = await client
      .from("iv_sections")
      .insert({ questionnaire_id: created.id, title: s.title, guide: s.guide ?? null, order: si })
      .select("id")
      .single();
    if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

    if (s.questions.length) {
      const { error: qErr } = await client.from("iv_questions").insert(
        s.questions.map((q, qi) => ({
          section_id: newSection.id,
          type: q.type,
          prompt: q.prompt,
          guide: q.guide ?? null,
          options: q.options ?? null,
          required: q.required ?? false,
          order: qi,
        }))
      );
      if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ questionnaire: created });
}
