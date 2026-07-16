"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface QRow {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
}
interface SRow {
  id: string;
  token: string;
  respondent_name: string;
  status: string;
  expires_at: string;
  submitted_at: string | null;
  created_at: string;
  iv_questionnaires: { title: string };
}

const STATUS: Record<string, { text: string; cls: string }> = {
  pending: { text: "대기", cls: "badge badge-pending" },
  in_progress: { text: "작성 중", cls: "badge badge-progress" },
  submitted: { text: "제출됨", cls: "badge badge-done" },
};

export default function Dashboard() {
  const [questionnaires, setQuestionnaires] = useState<QRow[]>([]);
  const [sessions, setSessions] = useState<SRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [sessionForm, setSessionForm] = useState({ questionnaire_id: "", respondent_name: "" });
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [qRes, sRes] = await Promise.all([
      fetch("/api/admin/questionnaires"),
      fetch("/api/admin/sessions"),
    ]);
    if (qRes.ok) setQuestionnaires((await qRes.json()).questionnaires);
    if (sRes.ok) setSessions((await sRes.json()).sessions);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createQuestionnaire() {
    if (!newTitle.trim()) return;
    const res = await fetch("/api/admin/questionnaires", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle.trim() }),
    });
    if (res.ok) {
      setNewTitle("");
      load();
    }
  }

  async function duplicateQuestionnaire(id: string) {
    const res = await fetch(`/api/admin/questionnaires/${id}/duplicate`, { method: "POST" });
    if (res.ok) {
      const { id: newId } = await res.json();
      // 복제 직후 바로 편집 화면으로 이동 — 새 프로젝트에 맞게 수정
      window.location.href = `/admin/q/${newId}`;
    } else {
      alert("복제에 실패했습니다.");
    }
  }

  async function deleteQuestionnaire(id: string) {
    if (!confirm("질문지를 삭제하면 연결된 세션과 응답도 모두 삭제됩니다. 계속할까요?")) return;
    await fetch(`/api/admin/questionnaires/${id}`, { method: "DELETE" });
    load();
  }

  async function createSession() {
    if (!sessionForm.questionnaire_id || !sessionForm.respondent_name.trim()) return;
    const res = await fetch("/api/admin/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sessionForm),
    });
    if (res.ok) {
      setSessionForm({ questionnaire_id: "", respondent_name: "" });
      load();
    }
  }

  async function deleteSession(id: string) {
    if (!confirm("세션과 응답을 삭제할까요?")) return;
    await fetch(`/api/admin/sessions/${id}`, { method: "DELETE" });
    load();
  }

  function copyLink(token: string) {
    navigator.clipboard.writeText(`${location.origin}/i/${token}`);
    setCopied(token);
    setTimeout(() => setCopied(null), 1500);
  }

  const submittedCount = sessions.filter((s) => s.status === "submitted").length;

  return (
    <div className="section-enter space-y-12">
      {/* 페이지 헤딩 — 어디에 있는지, 무엇이 있는지 (wayfinding) */}
      <div>
        <h1 className="text-3xl text-fg">인터뷰 관리</h1>
        <p className="mt-2 text-sm text-fg2">
          {loaded
            ? `질문지 ${questionnaires.length}개 · 세션 ${sessions.length}개 (제출 완료 ${submittedCount}개)`
            : "불러오는 중…"}
        </p>
      </div>

      {/* 질문지 */}
      <section aria-labelledby="q-heading">
        <h2 id="q-heading" className="text-xl text-fg">질문지</h2>
        <p className="mt-1 text-[13px] text-fg2">문항 세트를 만들고 편집합니다. 세션은 아래에서 질문지를 골라 발급합니다.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <label htmlFor="new-q" className="sr-only">새 질문지 제목</label>
          <input
            id="new-q"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createQuestionnaire()}
            placeholder="새 질문지 제목 (예: 대표 인터뷰 v3)"
            className="input flex-1"
          />
          <button onClick={createQuestionnaire} disabled={!newTitle.trim()} className="btn btn-primary shrink-0">
            질문지 만들기
          </button>
        </div>
        <ul className="card mt-4 divide-y divide-line !p-0">
          {loaded && questionnaires.length === 0 && (
            <li className="px-5 py-10 text-center text-sm text-fg2">
              아직 질문지가 없습니다. 위에서 첫 질문지를 만들어 보세요.
            </li>
          )}
          {questionnaires.map((q) => (
            <li key={q.id} className="group relative row-hover">
              <div className="flex items-center justify-between gap-3 px-5 py-4">
                <Link href={`/admin/q/${q.id}`} className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-fg group-hover:text-inv">
                    {q.title}
                  </span>
                  <span className="mt-0.5 block text-xs text-fg2">
                    {new Date(q.created_at).toLocaleDateString("ko-KR")} 생성 · 문항 편집 →
                  </span>
                </Link>
                <span className="flex shrink-0 items-center gap-4">
                  <button onClick={() => duplicateQuestionnaire(q.id)} className="link-quiet" title="이 질문지를 복사해 새 질문지로 만듭니다">
                    복제
                  </button>
                  <button
                    onClick={() => deleteQuestionnaire(q.id)}
                    className="link-quiet !text-danger/70 hover:!text-danger"
                  >
                    삭제
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* 세션 */}
      <section aria-labelledby="s-heading">
        <h2 id="s-heading" className="text-xl text-fg">인터뷰 세션</h2>
        <p className="mt-1 text-[13px] text-fg2">질문지와 응답자를 골라 링크를 발급하고, 응답 상태를 확인합니다.</p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <label htmlFor="s-q" className="sr-only">질문지 선택</label>
          <select
            id="s-q"
            value={sessionForm.questionnaire_id}
            onChange={(e) => setSessionForm((f) => ({ ...f, questionnaire_id: e.target.value }))}
            className="select sm:max-w-64"
          >
            <option value="">질문지 선택</option>
            {questionnaires.map((q) => (
              <option key={q.id} value={q.id}>{q.title}</option>
            ))}
          </select>
          <label htmlFor="s-name" className="sr-only">응답자 이름</label>
          <input
            id="s-name"
            value={sessionForm.respondent_name}
            onChange={(e) => setSessionForm((f) => ({ ...f, respondent_name: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && createSession()}
            placeholder="응답자 이름"
            className="input flex-1"
          />
          <button
            onClick={createSession}
            disabled={!sessionForm.questionnaire_id || !sessionForm.respondent_name.trim()}
            className="btn btn-primary shrink-0"
          >
            링크 발급
          </button>
        </div>
        <ul className="card mt-4 divide-y divide-line !p-0">
          {loaded && sessions.length === 0 && (
            <li className="px-5 py-10 text-center text-sm text-fg2">
              발급된 세션이 없습니다. 질문지와 응답자 이름을 입력해 링크를 만들어 보세요.
            </li>
          )}
          {sessions.map((s) => {
            const st = STATUS[s.status] ?? STATUS.pending;
            return (
              <li key={s.id} className="group row-hover">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <Link href={`/admin/s/${s.id}`} className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold text-fg group-hover:text-inv">
                        {s.respondent_name}
                      </span>
                      <span className={st.cls}>{st.text}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-fg2">
                      {s.iv_questionnaires?.title} · 만료 {new Date(s.expires_at).toLocaleDateString("ko-KR")} · 응답 보기 →
                    </span>
                  </Link>
                  <span className="flex shrink-0 items-center gap-4">
                    <button onClick={() => copyLink(s.token)} className="link-quiet">
                      {copied === s.token ? "복사됨 ✓" : "링크 복사"}
                    </button>
                    <button onClick={() => deleteSession(s.id)} className="link-quiet !text-danger/70 hover:!text-danger">
                      삭제
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
