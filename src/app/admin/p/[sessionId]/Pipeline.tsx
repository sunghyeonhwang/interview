"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Direction {
  name: string;
  concept: string;
  mood: string[];
  search_queries: string[];
}
interface Brief {
  id: string;
  content: { positioning: string; keywords: string[]; anti: string[]; directions: Direction[] };
  status: string;
}
interface Reference {
  id: string;
  direction: string;
  brand_name: string;
  url: string | null;
  image_url: string | null;
  summary: string | null;
  selected: boolean;
  note: string | null;
}
interface Concept {
  id: string;
  direction: string;
  engine: string;
  version: number;
  prompt: string;
  rationale: string | null;
  palette: string[] | null;
  selected: boolean;
  starred: boolean;
}
interface Svg {
  id: string;
  concept_id: string;
  version: number;
  svg: string;
}
interface Evaluation {
  id: string;
  concept_id: string;
  scores: { criterion: string; weight: number; score: number; reason: string }[];
  total: number;
  summary: string | null;
  created_at: string;
}
interface State {
  session: { id: string; respondent_name: string; status: string; iv_questionnaires: { title: string } };
  brief: Brief | null;
  references: Reference[];
  concepts: Concept[];
  svgs: Svg[];
  evaluations: Evaluation[];
  engines: ("openai" | "gemini")[];
  claudeReady: boolean;
}

type Tab = "brief" | "refs" | "concepts" | "eval" | "svg";
const TABS: { key: Tab; label: string }[] = [
  { key: "brief", label: "1. 브리프" },
  { key: "refs", label: "2. 레퍼런스" },
  { key: "concepts", label: "3. 시안" },
  { key: "eval", label: "4. 평가" },
  { key: "svg", label: "5. SVG" },
];

export default function Pipeline({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<State | null>(null);
  const [tab, setTab] = useState<Tab>("brief");
  const [busy, setBusy] = useState<string | null>(null); // 진행 중 작업 라벨
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/pipeline/${sessionId}`);
    if (res.ok) setState(await res.json());
    else setError("파이프라인을 불러오지 못했습니다.");
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(label: string, fn: () => Promise<Response>) {
    setBusy(label);
    setError("");
    try {
      const res = await fn();
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `${label} 실패`);
      }
      await load();
    } catch {
      setError(`${label} 중 오류가 발생했습니다.`);
    } finally {
      setBusy(null);
    }
  }

  if (!state) {
    return <p className="text-sm text-fg2">{error || "불러오는 중…"}</p>;
  }

  const { brief, references, concepts, svgs, evaluations, engines } = state;
  const directions = brief?.content.directions ?? [];
  const selectedConcepts = concepts.filter((c) => c.selected);
  const latestEval = (conceptId: string) => evaluations.find((e) => e.concept_id === conceptId);

  return (
    <div className="section-enter space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/admin/s/${sessionId}`} className="link-quiet">← 응답 보기</Link>
        {busy && <span className="badge badge-progress">{busy} 진행 중… (최대 2~3분)</span>}
      </div>

      <div>
        <h1 className="text-3xl text-fg">디자인 기획 파이프라인</h1>
        <p className="mt-2 text-sm text-fg2">
          {state.session.iv_questionnaires?.title} · {state.session.respondent_name}
        </p>
        {!state.claudeReady && (
          <p className="mt-2 text-sm text-danger">⚠️ ANTHROPIC_API_KEY가 설정되지 않아 기획·서치·SVG 기능을 사용할 수 없습니다.</p>
        )}
      </div>

      {/* 탭 */}
      <nav className="flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const done =
            t.key === "brief" ? !!brief :
            t.key === "refs" ? references.some((r) => r.selected) :
            t.key === "concepts" ? concepts.length > 0 :
            t.key === "eval" ? evaluations.length > 0 :
            svgs.length > 0;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`h-9 rounded-full px-4 text-sm font-semibold transition-colors duration-200 ${
                tab === t.key ? "bg-key text-white" : done ? "bg-inv/20 text-inv" : "border border-line text-fg2"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {/* ── 1. 브리프 ── */}
      {tab === "brief" && (
        <section className="space-y-4">
          {!brief ? (
            <div className="card text-center">
              <p className="text-sm text-fg2">인터뷰 답변을 분석해 포지셔닝·키워드·디자인 방향·서치 쿼리를 생성합니다.</p>
              <button
                onClick={() => run("브리프 생성", () => fetch(`/api/admin/pipeline/${sessionId}/brief`, { method: "POST" }))}
                disabled={!!busy || !state.claudeReady}
                className="btn btn-primary mt-4"
              >
                브리프 생성
              </button>
            </div>
          ) : (
            <>
              <div className="card">
                <h2 className="text-xl text-fg">포지셔닝</h2>
                <p className="mt-2 text-sm leading-relaxed text-fg">{brief.content.positioning}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {brief.content.keywords.map((k) => (
                    <span key={k} className="badge badge-done">{k}</span>
                  ))}
                  {brief.content.anti.map((k) => (
                    <span key={k} className="badge" style={{ background: "rgba(255,100,100,.12)", color: "var(--danger)" }}>✕ {k}</span>
                  ))}
                </div>
              </div>
              {directions.map((d) => (
                <div key={d.name} className="card">
                  <h2 className="text-xl text-fg">{d.name}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-fg2">{d.concept}</p>
                  <p className="mt-2 text-xs text-fg2">무드: {d.mood.join(" · ")}</p>
                  <div className="mt-3 space-y-1">
                    {d.search_queries.map((q) => (
                      <p key={q} className="rounded-(--radius-xs) bg-base/40 px-3 py-1.5 font-mono text-xs text-fg2">{q}</p>
                    ))}
                  </div>
                </div>
              ))}
              <button
                onClick={() => confirm("브리프를 다시 생성할까요? 기존 내용은 교체됩니다 (레퍼런스·시안은 유지).") && run("브리프 재생성", () => fetch(`/api/admin/pipeline/${sessionId}/brief`, { method: "POST" }))}
                disabled={!!busy}
                className="btn btn-ghost"
              >
                재생성
              </button>
            </>
          )}
        </section>
      )}

      {/* ── 2. 레퍼런스 ── */}
      {tab === "refs" && (
        <section className="space-y-4">
          {!brief ? (
            <p className="text-sm text-fg2">브리프를 먼저 생성하세요.</p>
          ) : (
            <>
              <div className="card">
                <h2 className="text-xl text-fg">벤치마크 서치</h2>
                <p className="mt-1 text-[13px] text-fg2">방향별 자동 쿼리 또는 직접 입력으로 실제 브랜드 사례를 수집합니다. Pinterest는 제외됩니다.</p>
                <div className="mt-4 space-y-2">
                  {directions.map((d) => (
                    <div key={d.name} className="flex flex-wrap items-center gap-2">
                      <span className="min-w-32 text-sm font-semibold text-fg">{d.name}</span>
                      <button
                        onClick={() => run(`"${d.name}" AI 서치`, () => fetch(`/api/admin/pipeline/${sessionId}/search`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ direction: d.name }),
                        }))}
                        disabled={!!busy || !engines.includes("gemini")}
                        className="btn btn-ghost !min-h-9 !py-1.5 text-xs"
                      >
                        🔍 AI 웹서치
                      </button>
                      <button
                        onClick={() => run(`"${d.name}" Behance 서치`, () => fetch(`/api/admin/pipeline/${sessionId}/search`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ direction: d.name, source: "behance" }),
                        }))}
                        disabled={!!busy}
                        className="btn btn-ghost !min-h-9 !py-1.5 text-xs"
                      >
                        Ⓑ Behance
                      </button>
                    </div>
                  ))}
                </div>
                <CustomSearch
                  disabled={!!busy}
                  onSearch={(q, source) => run(source === "behance" ? "Behance 직접 서치" : "AI 직접 서치", () => fetch(`/api/admin/pipeline/${sessionId}/search`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: q, source }),
                  }))}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {references.map((r) => (
                  <div key={r.id} className={`card !p-4 ${r.selected ? "!border-inv" : ""}`}>
                    {r.image_url && (
                      <a href={r.url ?? "#"} target="_blank" rel="noreferrer">
                        <img src={r.image_url} alt={r.brand_name} className="h-36 w-full rounded-(--radius-xs) bg-white object-cover" loading="lazy" />
                      </a>
                    )}
                    <div className="mt-3 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-fg">{r.brand_name}</p>
                        {r.url && (
                          <a href={r.url} target="_blank" rel="noreferrer" className="text-xs text-inv hover:underline">
                            {(() => { try { return new URL(r.url!).hostname; } catch { return r.url; } })()} ↗
                          </a>
                        )}
                      </div>
                      <button
                        onClick={() => run("선택", () => fetch(`/api/admin/pipeline/references/${r.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ selected: !r.selected }),
                        }))}
                        className={`btn !min-h-8 !px-3 !py-1 text-xs ${r.selected ? "btn-primary" : "btn-ghost"}`}
                      >
                        {r.selected ? "✓ 선택됨" : "선택"}
                      </button>
                    </div>
                    {r.summary && <p className="mt-2 text-xs leading-relaxed text-fg2">{r.summary}</p>}
                    <NoteInput refId={r.id} initial={r.note ?? ""} onSaved={load} />
                  </div>
                ))}
              </div>
              {references.length === 0 && <p className="text-center text-sm text-fg2">아직 수집된 레퍼런스가 없습니다. 위에서 서치를 실행하세요.</p>}
              <p className="text-xs text-fg2/60">※ 수집 이미지는 참고용입니다. 저작물을 직접 사용하지 마세요.</p>
            </>
          )}
        </section>
      )}

      {/* ── 3. 시안 ── */}
      {tab === "concepts" && (
        <section className="space-y-4">
          {!references.some((r) => r.selected) ? (
            <p className="text-sm text-fg2">레퍼런스를 1개 이상 선택하세요.</p>
          ) : (
            <>
              <div className="card">
                <h2 className="text-xl text-fg">시안 생성</h2>
                <p className="mt-1 text-[13px] text-fg2">
                  선택된 레퍼런스 {references.filter((r) => r.selected).length}개 기반 리디자인 · 라이트/다크 2장 + 제작 의도 포함
                </p>
                <div className="mt-4 space-y-2">
                  {directions.map((d) => (
                    <div key={d.name} className="flex flex-wrap items-center gap-2">
                      <span className="min-w-32 text-sm font-semibold text-fg">{d.name}</span>
                      {engines.map((e) => (
                        <button
                          key={e}
                          onClick={() => run(`${d.name} 시안 (${e})`, () => fetch(`/api/admin/pipeline/${sessionId}/concepts`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ direction: d.name, engine: e }),
                          }))}
                          disabled={!!busy}
                          className="btn btn-ghost !min-h-9 !py-1.5 text-xs"
                        >
                          {e === "openai" ? "🎨 GPT로 생성" : "🎨 Gemini로 생성"}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
                {engines.length === 0 && <p className="mt-3 text-sm text-danger">⚠️ OPENAI_API_KEY / GEMINI_API_KEY가 없어 이미지 생성을 사용할 수 없습니다.</p>}
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {concepts.map((c) => (
                  <div key={c.id} className={`card !p-4 ${c.selected ? "!border-inv" : ""}`}>
                    <div className="grid grid-cols-2 gap-2">
                      <img src={`/api/admin/pipeline/concepts/${c.id}/file?mode=light`} alt="라이트" className="w-full rounded-(--radius-xs) bg-white" loading="lazy" />
                      <img src={`/api/admin/pipeline/concepts/${c.id}/file?mode=dark`} alt="다크" className="w-full rounded-(--radius-xs) bg-black" loading="lazy" />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="badge badge-pending">{c.direction}</span>
                      <span className="badge badge-pending">{c.engine} v{c.version}</span>
                      {(c.palette ?? []).map((hex) => (
                        <span key={hex} title={hex} className="inline-block h-5 w-5 rounded-full border border-line" style={{ background: hex }} />
                      ))}
                      <span className="ml-auto flex gap-2">
                        <button
                          onClick={() => run("선택", () => fetch(`/api/admin/pipeline/concepts/${c.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ selected: !c.selected }),
                          }))}
                          className={`btn !min-h-8 !px-3 !py-1 text-xs ${c.selected ? "btn-primary" : "btn-ghost"}`}
                        >
                          {c.selected ? "✓ SVG 대상" : "SVG 대상으로 선택"}
                        </button>
                        <button
                          onClick={() => confirm("이 시안을 삭제할까요?") && run("삭제", () => fetch(`/api/admin/pipeline/concepts/${c.id}`, { method: "DELETE" }))}
                          className="link-quiet !text-danger/70 hover:!text-danger"
                        >
                          삭제
                        </button>
                      </span>
                    </div>
                    {c.rationale && (
                      <p className="mt-3 rounded-(--radius-xs) bg-base/40 px-3 py-2 text-[13px] leading-relaxed text-fg2">
                        <strong className="text-fg">제작 의도</strong> — {c.rationale}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              {concepts.length === 0 && <p className="text-center text-sm text-fg2">아직 생성된 시안이 없습니다.</p>}
            </>
          )}
        </section>
      )}

      {/* ── 4. 평가 ── */}
      {tab === "eval" && (
        <section className="space-y-4">
          {concepts.length === 0 ? (
            <p className="text-sm text-fg2">평가할 시안을 먼저 생성하세요.</p>
          ) : (
            <>
              <div className="card">
                <h2 className="text-xl text-fg">AI 평가</h2>
                <p className="mt-1 text-[13px] text-fg2">
                  독립 리뷰 보드 관점으로 시안을 채점합니다 — 전략 적합성(25) · 고객 신뢰(20) · 차별성(15) · 확장성(15) · 가독성(15) · 리스크(10). 결과는 저장되어 비교됩니다.
                </p>
              </div>

              {/* 랭킹 (평가된 시안만, 총점순) */}
              {evaluations.length > 0 && (
                <div className="card !p-4">
                  <h3 className="text-sm font-bold text-fg">랭킹</h3>
                  <div className="mt-2 space-y-1">
                    {[...concepts]
                      .map((c) => ({ c, e: latestEval(c.id) }))
                      .filter((x) => x.e)
                      .sort((a, b) => (b.e!.total ?? 0) - (a.e!.total ?? 0))
                      .map(({ c, e }, i) => (
                        <div key={c.id} className="flex items-center gap-3 rounded-(--radius-xs) bg-base/40 px-3 py-2 text-sm">
                          <span className="w-6 font-bold text-inv">{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate text-fg">{c.direction} · {c.engine} v{c.version}</span>
                          <span className="font-bold text-fg">{e!.total}점</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {concepts.map((c) => {
                  const ev = latestEval(c.id);
                  return (
                    <div key={c.id} className="card !p-4">
                      <div className="flex items-start gap-3">
                        <img src={`/api/admin/pipeline/concepts/${c.id}/file?mode=light`} alt="" className="h-20 w-20 shrink-0 rounded-(--radius-xs) bg-white object-cover" loading="lazy" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-fg">{c.direction} · {c.engine} v{c.version}</p>
                          {ev ? (
                            <p className="mt-0.5 text-2xl font-bold text-inv">{ev.total}<span className="text-sm text-fg2"> / 100</span></p>
                          ) : (
                            <p className="mt-0.5 text-xs text-fg2">아직 평가 없음</p>
                          )}
                        </div>
                        <span className="flex shrink-0 flex-col gap-1.5">
                          <button
                            onClick={() => run(`평가 (${c.direction})`, () => fetch(`/api/admin/pipeline/evaluate`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ concept_id: c.id }),
                            }))}
                            disabled={!!busy || !state.claudeReady}
                            className="btn btn-ghost !min-h-8 !py-1 text-xs"
                          >
                            {ev ? "재평가" : "AI 평가"}
                          </button>
                          <button
                            onClick={() => run("선택", () => fetch(`/api/admin/pipeline/concepts/${c.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ selected: !c.selected }),
                            }))}
                            disabled={!!busy}
                            className={`btn !min-h-8 !py-1 text-xs ${c.selected ? "btn-primary" : "btn-ghost"}`}
                          >
                            {c.selected ? "✓ 선택됨 → SVG" : "선택"}
                          </button>
                        </span>
                      </div>

                      {ev && (
                        <div className="mt-3 space-y-2">
                          {ev.scores.map((s) => (
                            <div key={s.criterion}>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-fg">{s.criterion} <span className="text-fg2">({s.weight})</span></span>
                                <span className="font-bold text-fg">{s.score}/10</span>
                              </div>
                              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-fg2/10">
                                <div className="h-full rounded-full bg-inv" style={{ width: `${s.score * 10}%` }} />
                              </div>
                              <p className="mt-1 text-xs leading-relaxed text-fg2">{s.reason}</p>
                            </div>
                          ))}
                          {ev.summary && (
                            <p className="rounded-(--radius-xs) bg-base/40 px-3 py-2 text-[13px] leading-relaxed text-fg2">
                              <strong className="text-fg">종합</strong> — {ev.summary}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-fg2/60">※ AI 평가는 참고용 1차 스크리닝입니다. 최종 선정은 대표와의 합의 기준으로 결정하세요.</p>
            </>
          )}
        </section>
      )}

      {/* ── 5. SVG ── */}
      {tab === "svg" && (
        <section className="space-y-4">
          {selectedConcepts.length === 0 ? (
            <p className="text-sm text-fg2">시안 탭에서 SVG로 만들 시안을 먼저 선택하세요.</p>
          ) : (
            <>
              <div className="card">
                <h2 className="text-xl text-fg">SVG 생성</h2>
                <p className="mt-1 text-[13px] text-fg2">선택된 시안을 분석해 깨끗한 벡터(SVG)로 재작성합니다.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {selectedConcepts.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => run(`SVG 생성 (${c.direction})`, () => fetch(`/api/admin/pipeline/svg`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ concept_id: c.id }),
                      }))}
                      disabled={!!busy || !state.claudeReady}
                      className="btn btn-primary !min-h-9 !py-1.5 text-xs"
                    >
                      ⬡ {c.direction} · {c.engine} v{c.version} → SVG
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {svgs.map((s) => {
                  const dataUri = `data:image/svg+xml;base64,${typeof window !== "undefined" ? btoa(unescape(encodeURIComponent(s.svg))) : ""}`;
                  const parent = concepts.find((c) => c.id === s.concept_id);
                  return (
                    <div key={s.id} className="card !p-4">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center justify-center rounded-(--radius-xs) bg-white p-6">
                          <img src={dataUri} alt="SVG 라이트" className="max-h-40 w-full object-contain" />
                        </div>
                        <div className="flex items-center justify-center rounded-(--radius-xs) bg-black p-6">
                          <img src={dataUri} alt="SVG 다크" className="max-h-40 w-full object-contain" />
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="badge badge-pending">{parent?.direction ?? ""} · SVG v{s.version}</span>
                        <span className="ml-auto flex gap-3">
                          <a href={`/api/admin/pipeline/svg/${s.id}`} className="btn btn-primary !min-h-8 !px-3 !py-1 text-xs">.svg 다운로드</a>
                          <button
                            onClick={() => confirm("이 SVG를 삭제할까요?") && run("삭제", () => fetch(`/api/admin/pipeline/svg/${s.id}`, { method: "DELETE" }))}
                            className="link-quiet !text-danger/70 hover:!text-danger"
                          >
                            삭제
                          </button>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {svgs.length === 0 && <p className="text-center text-sm text-fg2">아직 생성된 SVG가 없습니다.</p>}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function CustomSearch({ disabled, onSearch }: { disabled: boolean; onSearch: (q: string, source: "claude" | "behance") => void }) {
  const [q, setQ] = useState("");
  const fire = (source: "claude" | "behance") => {
    if (!q.trim()) return;
    onSearch(q.trim(), source);
    setQ("");
  };
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && fire("behance")}
        placeholder='직접 검색 — 예: "디자인상 수상 경력의 일본 병원 로고 브랜딩 사례"'
        className="input min-w-60 flex-1"
        disabled={disabled}
      />
      <button onClick={() => fire("claude")} disabled={disabled || !q.trim()} className="btn btn-ghost shrink-0">
        🔍 AI 웹서치
      </button>
      <button onClick={() => fire("behance")} disabled={disabled || !q.trim()} className="btn btn-ghost shrink-0">
        Ⓑ Behance
      </button>
    </div>
  );
}

function NoteInput({ refId, initial, onSaved }: { refId: string; initial: string; onSaved: () => void }) {
  const [note, setNote] = useState(initial);
  const [saved, setSaved] = useState(false);
  return (
    <input
      value={note}
      onChange={(e) => { setNote(e.target.value); setSaved(false); }}
      onBlur={async () => {
        if (note === initial) return;
        await fetch(`/api/admin/pipeline/references/${refId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note }),
        });
        setSaved(true);
        onSaved();
      }}
      placeholder={saved ? "메모 저장됨 ✓" : "메모 (어떤 점을 참고할지)"}
      className="input mt-2 !py-1.5 text-xs"
    />
  );
}
