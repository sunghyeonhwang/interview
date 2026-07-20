"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { QuestionType, ScaleOptions } from "@/lib/types";

interface EQuestion {
  id?: string;
  type: QuestionType;
  prompt: string;
  guide: string;
  options: string[] | ScaleOptions | null;
  required: boolean;
}
interface ESection {
  id?: string;
  title: string;
  guide: string;
  questions: EQuestion[];
}

const TYPE_LABEL: Record<QuestionType, string> = {
  text: "장문 서술",
  short: "단답",
  single: "단일 선택",
  multi: "복수 선택",
  scale: "척도",
  image: "이미지 업로드",
};

function defaultOptions(type: QuestionType): EQuestion["options"] {
  if (type === "single" || type === "multi") return ["보기 1", "보기 2"];
  if (type === "scale") return { min: 1, max: 5, minLabel: "", maxLabel: "" };
  return null;
}

export default function Editor({ questionnaireId }: { questionnaireId: string }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sections, setSections] = useState<ESection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/questionnaires/${questionnaireId}`);
    if (!res.ok) {
      setError("질문지를 불러오지 못했습니다.");
      return;
    }
    const { questionnaire } = await res.json();
    setTitle(questionnaire.title);
    setDescription(questionnaire.description ?? "");
    setSections(
      questionnaire.sections.map((s: ESection & { guide: string | null }) => ({
        id: s.id,
        title: s.title,
        guide: s.guide ?? "",
        questions: s.questions.map((q: EQuestion & { guide: string | null }) => ({
          id: q.id,
          type: q.type,
          prompt: q.prompt,
          guide: q.guide ?? "",
          options: q.options,
          required: q.required,
        })),
      }))
    );
    setLoaded(true);
  }, [questionnaireId]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError("");
    const res = await fetch(`/api/admin/questionnaires/${questionnaireId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        description: description || null,
        sections: sections.map((s) => ({
          ...s,
          guide: s.guide || null,
          questions: s.questions.map((q) => ({ ...q, guide: q.guide || null })),
        })),
      }),
    });
    setSaving(false);
    if (res.ok) {
      setSavedAt(new Date().toLocaleTimeString("ko-KR"));
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "저장에 실패했습니다.");
    }
  }

  function updateSection(si: number, patch: Partial<ESection>) {
    setSections((prev) => prev.map((s, i) => (i === si ? { ...s, ...patch } : s)));
  }
  function updateQuestion(si: number, qi: number, patch: Partial<EQuestion>) {
    setSections((prev) =>
      prev.map((s, i) =>
        i === si ? { ...s, questions: s.questions.map((q, j) => (j === qi ? { ...q, ...patch } : q)) } : s
      )
    );
  }
  function move<T>(arr: T[], from: number, to: number): T[] {
    if (to < 0 || to >= arr.length) return arr;
    const next = [...arr];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  }

  if (!loaded && !error) return <p className="text-sm text-fg2/45">불러오는 중…</p>;

  return (
    <div className="space-y-6 pb-24">
      {/* 상단 액션 바 — 모바일 고정 */}
      <div className="chrome chrome-top sticky top-[57px] z-10 -mx-4 flex items-center justify-between px-4 py-3">
        <Link href="/admin" className="link-quiet">← 대시보드</Link>
        <div className="flex items-center gap-3">
          {savedAt && <span className="text-xs text-fg2/45">저장됨 {savedAt}</span>}
          {error && <span role="alert" className="text-xs text-danger">{error}</span>}
          <button onClick={save} disabled={saving} className="btn btn-primary !min-h-9 !py-1.5">
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>

      <div className="card">
        <label htmlFor="q-title" className="sr-only">질문지 제목</label>
        <input
          id="q-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="질문지 제목"
          className="w-full bg-transparent text-lg font-bold text-fg placeholder:text-fg2/35 focus:outline-none"
        />
        <label htmlFor="q-desc" className="sr-only">인트로 안내문</label>
        <textarea
          id="q-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="인트로 안내문 (응답자 첫 화면 — 목적·소요 시간·개인정보 안내 등)"
          rows={4}
          className="textarea mt-4 text-sm"
        />
      </div>

      {sections.map((s, si) => (
        <div key={s.id ?? `new-${si}`} className="card">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-fg2/45">섹션 {si + 1}</span>
            <div className="ml-auto flex items-center gap-3 text-xs">
              <button aria-label="섹션 위로" onClick={() => setSections((p) => move(p, si, si - 1))} className="link-quiet">↑</button>
              <button aria-label="섹션 아래로" onClick={() => setSections((p) => move(p, si, si + 1))} className="link-quiet">↓</button>
              <button
                onClick={() => confirm("섹션을 삭제할까요? 이미 수집된 이 섹션의 응답도 저장 시 삭제됩니다.") && setSections((p) => p.filter((_, i) => i !== si))}
                className="link-quiet !text-danger/70 hover:!text-danger"
              >
                섹션 삭제
              </button>
            </div>
          </div>
          <input
            value={s.title}
            onChange={(e) => updateSection(si, { title: e.target.value })}
            placeholder="섹션 제목"
            className="mt-3 w-full bg-transparent text-base font-semibold text-fg placeholder:text-fg2/35 focus:outline-none"
          />
          <input
            value={s.guide}
            onChange={(e) => updateSection(si, { guide: e.target.value })}
            placeholder="섹션 안내문 (선택)"
            className="mt-1 w-full bg-transparent text-sm text-fg2/70 placeholder:text-fg2/30 focus:outline-none"
          />

          <div className="mt-5 space-y-4">
            {s.questions.map((q, qi) => (
              <div key={q.id ?? `new-${si}-${qi}`} className="rounded-(--radius-xs) border border-line bg-base/40 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={q.type}
                    onChange={(e) => {
                      const type = e.target.value as QuestionType;
                      updateQuestion(si, qi, { type, options: defaultOptions(type) });
                    }}
                    className="select !w-auto !py-1.5 text-xs"
                    aria-label="문항 유형"
                  >
                    {Object.entries(TYPE_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1.5 text-xs text-fg2/70">
                    <input
                      type="checkbox"
                      checked={q.required}
                      onChange={(e) => updateQuestion(si, qi, { required: e.target.checked })}
                      className="accent-(--text-inverse)"
                    />
                    필수
                  </label>
                  <div className="ml-auto flex items-center gap-3 text-xs">
                    <button aria-label="문항 위로" onClick={() => updateSection(si, { questions: move(s.questions, qi, qi - 1) })} className="link-quiet">↑</button>
                    <button aria-label="문항 아래로" onClick={() => updateSection(si, { questions: move(s.questions, qi, qi + 1) })} className="link-quiet">↓</button>
                    <button
                      onClick={() => updateSection(si, { questions: s.questions.filter((_, j) => j !== qi) })}
                      className="link-quiet !text-danger/70 hover:!text-danger"
                    >
                      삭제
                    </button>
                  </div>
                </div>
                <textarea
                  value={q.prompt}
                  onChange={(e) => updateQuestion(si, qi, { prompt: e.target.value })}
                  placeholder="질문 내용"
                  rows={2}
                  className="textarea mt-3 !min-h-16 text-sm"
                />
                <input
                  value={q.guide}
                  onChange={(e) => updateQuestion(si, qi, { guide: e.target.value })}
                  placeholder="안내문 — 왜 묻는지, 답변 예시 힌트 (선택)"
                  className="input mt-2 !py-1.5 text-xs"
                />
                {(q.type === "single" || q.type === "multi") && Array.isArray(q.options) && (
                  <div className="mt-3 space-y-1.5">
                    {q.options.map((opt, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        <input
                          value={opt}
                          onChange={(e) => {
                            const options = [...(q.options as string[])];
                            options[oi] = e.target.value;
                            updateQuestion(si, qi, { options });
                          }}
                          className="input flex-1 !py-1.5 text-xs"
                          aria-label={`보기 ${oi + 1}`}
                        />
                        <button
                          onClick={() => updateQuestion(si, qi, { options: (q.options as string[]).filter((_, j) => j !== oi) })}
                          className="link-quiet !text-danger/70 hover:!text-danger"
                          aria-label={`보기 ${oi + 1} 삭제`}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => updateQuestion(si, qi, { options: [...(q.options as string[]), `보기 ${(q.options as string[]).length + 1}`] })}
                      className="link-quiet"
                    >
                      + 보기 추가
                    </button>
                  </div>
                )}
                {q.type === "scale" && q.options && !Array.isArray(q.options) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <input
                      type="number"
                      value={q.options.min}
                      onChange={(e) => updateQuestion(si, qi, { options: { ...(q.options as ScaleOptions), min: Number(e.target.value) } })}
                      className="input !w-16 !py-1.5"
                      aria-label="척도 최솟값"
                    />
                    <span className="text-fg2/45">~</span>
                    <input
                      type="number"
                      value={q.options.max}
                      onChange={(e) => updateQuestion(si, qi, { options: { ...(q.options as ScaleOptions), max: Number(e.target.value) } })}
                      className="input !w-16 !py-1.5"
                      aria-label="척도 최댓값"
                    />
                    <input
                      value={q.options.minLabel ?? ""}
                      onChange={(e) => updateQuestion(si, qi, { options: { ...(q.options as ScaleOptions), minLabel: e.target.value } })}
                      placeholder="최소 라벨"
                      className="input min-w-32 flex-1 !py-1.5"
                    />
                    <input
                      value={q.options.maxLabel ?? ""}
                      onChange={(e) => updateQuestion(si, qi, { options: { ...(q.options as ScaleOptions), maxLabel: e.target.value } })}
                      placeholder="최대 라벨"
                      className="input min-w-32 flex-1 !py-1.5"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={() =>
              updateSection(si, {
                questions: [...s.questions, { type: "text", prompt: "", guide: "", options: null, required: false }],
              })
            }
            className="link-quiet mt-4"
          >
            + 문항 추가
          </button>
        </div>
      ))}

      <button
        onClick={() => setSections((p) => [...p, { title: "", guide: "", questions: [] }])}
        className="w-full rounded-(--radius-sm) border border-dashed border-line-strong py-4 text-sm text-fg2/60 transition-colors duration-200 hover:border-inv hover:text-fg"
      >
        + 섹션 추가
      </button>
    </div>
  );
}
