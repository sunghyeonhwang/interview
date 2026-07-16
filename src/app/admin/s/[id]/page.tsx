import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import type { Question, ScaleOptions } from "@/lib/types";
import SessionActions from "./SessionActions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  pending: "대기 (미시작)",
  in_progress: "작성 중",
  submitted: "제출 완료",
};

function renderValue(q: Question, value: unknown) {
  if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) {
    return <span className="text-fg2/30">무응답</span>;
  }
  if (q.type === "multi" && Array.isArray(value)) {
    return (
      <ul className="list-disc pl-5">
        {value.map((v, i) => (
          <li key={i}>{String(v)}</li>
        ))}
      </ul>
    );
  }
  if (q.type === "scale") {
    const opt = (q.options ?? { min: 1, max: 5 }) as ScaleOptions;
    return (
      <span>
        <strong className="text-inv">{String(value)}</strong> / {opt.max}
        {opt.maxLabel && <span className="text-fg2/45"> ({opt.minLabel} ↔ {opt.maxLabel})</span>}
      </span>
    );
  }
  return <span className="whitespace-pre-wrap">{String(value)}</span>;
}

export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = db();

  const { data: session } = await client
    .from("iv_sessions")
    .select("*, iv_questionnaires(id, title)")
    .eq("id", id)
    .single();
  if (!session) notFound();

  const { data: sections } = await client
    .from("iv_sections")
    .select("*, iv_questions(*)")
    .eq("questionnaire_id", session.iv_questionnaires.id)
    .order("order");

  const { data: answers } = await client
    .from("iv_answers")
    .select("question_id, value, updated_at")
    .eq("session_id", id);
  const answerMap = new Map((answers ?? []).map((a) => [a.question_id, a.value]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin" className="link-quiet">← 대시보드</Link>
        <SessionActions sessionId={id} token={session.token} status={session.status} />
      </div>

      <div className="card">
        <h1 className="text-lg font-bold text-fg">{session.respondent_name}</h1>
        <p className="mt-1 text-sm text-fg2/60">
          {session.iv_questionnaires.title} · {STATUS[session.status]}
          {session.submitted_at && ` · ${new Date(session.submitted_at).toLocaleString("ko-KR")} 제출`}
        </p>
        {session.respondent_email && (
          <p className="mt-1 text-sm text-fg2/60">
            이메일: <a href={`mailto:${session.respondent_email}`} className="text-inv hover:underline">{session.respondent_email}</a>
          </p>
        )}
      </div>

      {(sections ?? []).map((s) => (
        <div key={s.id} className="card">
          <h2 className="text-base font-semibold text-fg">{s.title}</h2>
          <div className="mt-5 space-y-6">
            {(s.iv_questions ?? [])
              .sort((a: Question, b: Question) => a.order - b.order)
              .map((q: Question) => (
                <div key={q.id}>
                  <p className="text-sm font-medium text-fg2">{q.prompt}</p>
                  <div className="mt-2 rounded-(--radius-xs) border border-line bg-base/40 px-4 py-3 text-[15px] text-fg">
                    {renderValue(q, answerMap.get(q.id))}
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
