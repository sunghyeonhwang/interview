"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Logo from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import type { Question, ScaleOptions, AnswerMap, AnswerValue } from "@/lib/types";

interface RSection {
  id: string;
  title: string;
  guide: string | null;
  questions: Question[];
}
interface Payload {
  questionnaire: { title: string; description: string | null; sections: RSection[] };
  respondent_name: string;
  respondent_email?: string;
  status: string;
  answers: AnswerMap;
}

function isEmpty(v: AnswerValue | undefined) {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}

export default function RespondentForm({ token }: { token: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [started, setStarted] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [step, setStep] = useState(0); // 현재 섹션 인덱스
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved">("idle");
  const [submitError, setSubmitError] = useState("");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [starting, setStarting] = useState(false);

  const dirtyRef = useRef<Set<string>>(new Set());
  const answersRef = useRef<AnswerMap>({});
  answersRef.current = answers;

  useEffect(() => {
    fetch(`/api/i/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? "링크를 확인할 수 없습니다.");
        return res.json();
      })
      .then((d: Payload) => {
        setData(d);
        setAnswers(d.answers ?? {});
        setEmail(d.respondent_email ?? "");
        if (d.status === "submitted") setSubmitted(true);
        else if (d.status === "in_progress") {
          setStarted(true);
          // 이어서 작성: 비어 있는 답이 있는 첫 섹션에서 시작
          const resumeIdx = d.questionnaire.sections.findIndex((s) =>
            s.questions.some((q) => isEmpty((d.answers ?? {})[q.id]))
          );
          setStep(resumeIdx === -1 ? d.questionnaire.sections.length - 1 : resumeIdx);
        }
      })
      .catch((e) => setError(e.message));
  }, [token]);

  const flush = useCallback(async () => {
    const dirty = dirtyRef.current;
    if (dirty.size === 0) return true;
    const payload: AnswerMap = {};
    for (const qid of dirty) payload[qid] = answersRef.current[qid];
    dirtyRef.current = new Set();
    setSaveState("saving");
    try {
      const res = await fetch(`/api/i/${token}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: payload }),
      });
      if (!res.ok) throw new Error();
      setSaveState("saved");
      return true;
    } catch {
      for (const qid of Object.keys(payload)) dirtyRef.current.add(qid);
      setSaveState("dirty");
      return false;
    }
  }, [token]);

  useEffect(() => {
    const iv = setInterval(flush, 3000);
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [flush]);

  function setAnswer(qid: string, value: AnswerValue) {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
    dirtyRef.current.add(qid);
    setSaveState("dirty");
  }

  function goTo(next: number) {
    flush();
    setSubmitError("");
    setStep(next);
    window.scrollTo({ top: 0 });
  }

  async function submit() {
    if (!data) return;
    setSubmitError("");
    const sections = data.questionnaire.sections;
    for (let si = 0; si < sections.length; si++) {
      const missing = sections[si].questions.filter((q) => q.required && isEmpty(answers[q.id]));
      if (missing.length > 0) {
        setStep(si);
        window.scrollTo({ top: 0 });
        setSubmitError(`${si + 1}번 섹션에 필수 문항 ${missing.length}개가 비어 있습니다.`);
        return;
      }
    }
    if (!confirm("제출할까요? 제출 후에도 수정이 필요하면 담당자에게 요청해 다시 열 수 있습니다.")) return;
    const ok = await flush();
    if (!ok) {
      setSubmitError("저장에 실패했습니다. 네트워크를 확인하고 다시 시도해주세요.");
      return;
    }
    const res = await fetch(`/api/i/${token}`, { method: "POST" });
    if (res.ok) setSubmitted(true);
    else setSubmitError("제출에 실패했습니다. 잠시 후 다시 시도해주세요.");
  }

  async function startInterview() {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError("올바른 이메일 주소를 입력해주세요.");
      return;
    }
    setStarting(true);
    const res = await fetch(`/api/i/${token}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: trimmed }),
    });
    setStarting(false);
    if (res.ok) setStarted(true);
    else {
      const d = await res.json().catch(() => ({}));
      setEmailError(d.error ?? "저장에 실패했습니다. 다시 시도해주세요.");
    }
  }

  const sections = data?.questionnaire.sections ?? [];
  const allQuestions = sections.flatMap((s) => s.questions);
  const answeredCount = allQuestions.filter((q) => !isEmpty(answers[q.id])).length;
  const progress = allQuestions.length ? Math.round((answeredCount / allQuestions.length) * 100) : 0;
  const isLast = step === sections.length - 1;
  const current = sections[step];

  if (error) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4">
        <Logo height={24} />
        <p className="text-fg2/70">{error}</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="flex flex-1 items-center justify-center px-4">
        <p className="text-fg2/45">불러오는 중…</p>
      </main>
    );
  }
  if (submitted) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="mb-8">
          <Logo height={24} />
        </div>
        <div className="card w-full max-w-xl text-center !p-8 sm:!p-12">
          <p className="text-3xl" aria-hidden>✓</p>
          <h1 className="mt-3 text-2xl text-fg">제출이 완료되었습니다</h1>
          <p className="mt-3 text-sm leading-relaxed text-fg2/70">
            {data.respondent_name}님, 소중한 답변 감사합니다. 주신 내용을 정리해 후속 미팅에서 함께 검토하겠습니다.
          </p>
          <p className="mt-4 text-xs text-fg2/45">
            답변을 수정해야 하면 담당자에게 요청해주세요. 같은 링크에서 이어서 수정할 수 있도록 다시 열어드립니다.
          </p>
        </div>
      </main>
    );
  }
  if (!started) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="mb-8">
          <Logo height={24} />
        </div>
        <div className="card w-full max-w-2xl !p-8 sm:!p-12">
          <p className="text-xs font-semibold tracking-widest text-fg2/50">BRAND INTERVIEW</p>
          <h1 className="mt-3 text-3xl text-fg">{data.questionnaire.title}</h1>
          {data.questionnaire.description && (
            <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-fg2/80">
              {data.questionnaire.description}
            </p>
          )}
          <ul className="mt-6 space-y-1.5 text-xs leading-relaxed text-fg2">
            <li>· <strong className="text-fg">전체 문항을 모두 적으실 필요는 없습니다.</strong> 필수 표시(<span className="text-danger">*</span>)가 있는 문항만 채우시면 되고, 나머지는 건너뛰어도 됩니다.</li>
            <li>· 총 {sections.length}개 파트로 나뉘어 있으며, 파트별로 이동하며 작성합니다.</li>
            <li>· 답변은 자동으로 저장되며, 중단 후 같은 링크로 이어서 작성할 수 있습니다.</li>
            <li>· 핸드폰에서도 작성하실 수 있습니다.</li>
            <li>· 수집된 답변은 브랜딩 프로젝트 목적으로만 사용됩니다.</li>
          </ul>
          <div className="mt-7">
            <label htmlFor="r-email" className="text-sm font-bold text-fg">
              이메일 <span className="text-danger">*</span>
            </label>
            <p className="mt-0.5 text-[13px] text-fg2">진행 안내와 결과 공유에 사용됩니다.</p>
            <input
              id="r-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailError("");
              }}
              placeholder="name@example.com"
              autoComplete="email"
              className="input mt-2"
            />
            {emailError && <p role="alert" className="mt-1.5 text-xs text-danger">{emailError}</p>}
          </div>
          <button onClick={startInterview} disabled={starting} className="btn btn-primary mt-6 w-full">
            {starting ? "시작하는 중…" : "시작하기"}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-36 pt-6 sm:pt-8">
      {/* 상단 고정 바 */}
      <div className="chrome chrome-top sticky top-0 z-20 -mx-4 px-4 pb-3 pt-3">
        <div className="grid grid-cols-3 items-center">
          <span className="justify-self-start text-xs text-fg2/50">
            파트 {step + 1}/{sections.length}
          </span>
          <span className="justify-self-center">
            <Logo height={18} />
          </span>
          <div className="flex items-center gap-2 justify-self-end">
            <ThemeToggle />
            <span className="hidden text-xs text-fg2/50 sm:inline" role="status">
              {saveState === "saving" ? "저장 중…" : saveState === "saved" ? "저장됨 ✓" : saveState === "dirty" ? "변경됨" : ""}
            </span>
            <button
              onClick={flush}
              disabled={saveState === "saving" || saveState === "saved" || saveState === "idle"}
              className="btn btn-ghost !min-h-8 !px-4 !py-1 text-xs"
            >
              {saveState === "saving" ? "저장 중…" : saveState === "saved" ? "저장됨 ✓" : "임시저장"}
            </button>
          </div>
        </div>
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-fg2/10" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="전체 진행률">
          <div className="h-full rounded-full bg-inv transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* 파트 스텝 표시 */}
      <nav aria-label="파트 이동" className="mt-6 flex flex-wrap gap-1.5">
        {sections.map((s, si) => {
          const done = s.questions.every((q) => !q.required || !isEmpty(answers[q.id]));
          const active = si === step;
          return (
            <button
              key={s.id}
              onClick={() => goTo(si)}
              aria-current={active ? "step" : undefined}
              title={s.title}
              className={`h-8 min-w-8 rounded-full px-2 text-xs font-semibold transition-colors duration-200 ${
                active
                  ? "bg-key text-white"
                  : done
                    ? "bg-inv/20 text-inv hover:bg-inv/30"
                    : "border border-line text-fg2/50 hover:border-line-strong hover:text-fg"
              }`}
            >
              {si + 1}
            </button>
          );
        })}
      </nav>

      {/* 현재 파트 */}
      {current && (
        <section key={current.id} aria-labelledby="sec-title" className="section-enter mt-6">
          <h2 id="sec-title" className="text-2xl text-fg">
            <span className="mr-2 text-fg2/40">{step + 1}.</span>
            {current.title}
          </h2>
          {current.guide && <p className="mt-2 text-sm leading-relaxed text-fg2">{current.guide}</p>}
          <div className="mt-6 space-y-8">
            {current.questions.map((q) => (
              <QuestionField key={q.id} q={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />
            ))}
          </div>
        </section>
      )}

      {/* 하단 내비게이션 바 */}
      <div className="chrome chrome-bottom fixed inset-x-0 bottom-0 z-20 px-4 py-3">
        <div className="mx-auto max-w-3xl">
          {submitError && (
            <p role="alert" className="mb-2 text-xs leading-snug text-danger">{submitError}</p>
          )}
          <div className="flex items-center gap-3">
            <button onClick={() => goTo(step - 1)} disabled={step === 0} className="btn btn-ghost shrink-0">
              ← 이전
            </button>
            <p className="min-w-0 flex-1 text-center text-xs text-fg2/45">
              {answeredCount}/{allQuestions.length} 문항 작성됨
            </p>
            {isLast ? (
              <button onClick={submit} className="btn btn-primary shrink-0">제출하기</button>
            ) : (
              <button onClick={() => goTo(step + 1)} className="btn btn-primary shrink-0">다음 →</button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function QuestionField({
  q,
  value,
  onChange,
}: {
  q: Question;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
}) {
  const scale = q.type === "scale" ? ((q.options ?? { min: 1, max: 5 }) as ScaleOptions) : null;
  return (
    <div>
      <p className="text-base font-bold leading-relaxed text-fg">
        {q.prompt}
        {q.required && <span className="ml-1 text-danger" aria-label="필수">*</span>}
      </p>
      {q.guide && <p className="mt-1 text-[13px] font-light leading-relaxed text-fg2">{q.guide}</p>}

      {q.type === "text" && (
        <textarea
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          className="textarea mt-3"
          aria-label={q.prompt}
        />
      )}
      {q.type === "short" && (
        <input
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          className="input mt-3"
          aria-label={q.prompt}
        />
      )}
      {q.type === "single" && Array.isArray(q.options) && (
        <div className="mt-3 space-y-2" role="radiogroup" aria-label={q.prompt}>
          {q.options.map((opt) => (
            <label key={opt} className="choice">
              <input type="radio" name={q.id} checked={value === opt} onChange={() => onChange(opt)} />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      )}
      {q.type === "multi" && Array.isArray(q.options) && (
        <div className="mt-3 space-y-2" role="group" aria-label={q.prompt}>
          {q.options.map((opt) => {
            const arr = Array.isArray(value) ? (value as string[]) : [];
            const checked = arr.includes(opt);
            return (
              <label key={opt} className="choice">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onChange(checked ? arr.filter((x) => x !== opt) : [...arr, opt])}
                />
                <span>{opt}</span>
              </label>
            );
          })}
        </div>
      )}
      {q.type === "scale" && scale && (
        <div className="mt-3">
          <div className="flex gap-1.5 sm:gap-2" role="radiogroup" aria-label={q.prompt}>
            {Array.from({ length: scale.max - scale.min + 1 }, (_, i) => scale.min + i).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={value === n}
                onClick={() => onChange(n)}
                className={`h-11 min-w-11 flex-1 rounded-(--radius-xs) border text-sm font-semibold transition-colors duration-200 ${
                  value === n
                    ? "border-inv bg-key text-white"
                    : "border-line text-fg2/70 hover:border-line-strong hover:text-fg"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          {(scale.minLabel || scale.maxLabel) && (
            <div className="mt-1.5 flex justify-between gap-4 text-xs text-fg2/50">
              <span>{scale.minLabel}</span>
              <span className="text-right">{scale.maxLabel}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
