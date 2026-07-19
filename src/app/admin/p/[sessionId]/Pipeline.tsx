"use client";

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DEFAULT_CRITERIA, type Criterion } from "@/lib/criteria";

interface Direction {
  name: string;
  concept: string;
  mood: string[];
  search_queries: string[];
  origin?: "counter" | "seed"; // undefined = 인터뷰/애셋 기반, counter = 역제안, seed = 관리자 아이디어
}
const originBadge = (o?: string) =>
  o === "counter" ? <span className="badge badge-progress">🔄 역제안</span> :
  o === "seed" ? <span className="badge badge-pending">💡 아이디어</span> : null;
interface Brief {
  id: string;
  content: { positioning: string; keywords: string[]; anti: string[]; directions: Direction[] };
  status: string;
  current_round: number;
  round_feedback: { round: number; feedback: string }[];
  criteria: Criterion[] | null;
  reset_notes: { feedback: string; created_at: string }[];
}
interface Reference {
  id: string;
  direction: string;
  brand_name: string;
  url: string | null;
  image_url: string | null;
  image_path: string | null;
  summary: string | null;
  selected: boolean;
  note: string | null;
}
interface Concept {
  id: string;
  direction: string;
  engine: string;
  gen_model: string | null;
  round: number;
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
interface Mockup {
  id: string;
  concept_id: string;
  kind: string;
}
const MOCKUP_KINDS: { kind: string; label: string }[] = [
  { kind: "sign", label: "간판" },
  { kind: "card", label: "명함" },
  { kind: "appicon", label: "앱 아이콘" },
  { kind: "uniform", label: "유니폼" },
];
const mockupLabel = (k: string) => MOCKUP_KINDS.find((m) => m.kind === k)?.label ?? k;
interface Evaluation {
  id: string;
  concept_id: string;
  scores: { criterion: string; weight: number; score: number; reason: string }[];
  total: number;
  summary: string | null;
  created_at: string;
}
interface Project {
  id: string;
  title: string;
  brand_name: string;
  goal: string | null;
  key_colors: string[];
  asset_urls: string[];
}
interface State {
  session: { id: string; respondent_name: string; status: string; iv_questionnaires: { title: string } } | null;
  project: Project | null;
  brief: Brief | null;
  references: Reference[];
  concepts: Concept[];
  svgs: Svg[];
  evaluations: Evaluation[];
  mockups: Mockup[];
  engines: ("openai" | "gemini")[];
  claudeReady: boolean;
}

type Tab = "brief" | "refs" | "concepts" | "eval" | "svg";

const engineLabel = (e: string) => (e === "openai" ? "GPT" : "Gemini");

interface GenOptions {
  logo_type: string;
  color_hint: string;
  extra: string;
  geometry: string; // "" 자동 | golden 황금비 | grid 정수비 그리드
}
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
  const [notice, setNotice] = useState(""); // 완료 토스트 (자동 소멸)

  function flashNotice(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice((n) => (n === msg ? "" : n)), 6000);
  }
  const [genOpts, setGenOpts] = useState<GenOptions>({ logo_type: "", color_hint: "", extra: "", geometry: "" });
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [autoEval, setAutoEval] = useState(false);
  const [selfRefine, setSelfRefine] = useState(false);
  const [cFilter, setCFilter] = useState({ dir: "", round: "", starred: false, sort: "recent" as "recent" | "score" });
  const [editingBrief, setEditingBrief] = useState(false);
  const [editingCriteria, setEditingCriteria] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/pipeline/${sessionId}`);
    if (res.ok) setState(await res.json());
    else setError("파이프라인을 불러오지 못했습니다.");
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  // 탭을 URL과 동기화 — 새로고침·재진입 시 보던 탭 유지, 딥링크 공유 가능
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && TABS.some((x) => x.key === t)) setTab(t as Tab);
  }, []);
  const changeTab = useCallback((t: Tab) => {
    setTab(t);
    window.history.replaceState(null, "", `?tab=${t}`);
  }, []);

  async function run(label: string, fn: () => Promise<Response>) {
    setBusy(label);
    setError("");
    try {
      const res = await fn();
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? `${label} 실패`);
      } else {
        flashNotice(`✅ ${label} 완료`);
      }
      await load();
    } catch {
      setError(`${label} 중 오류가 발생했습니다.`);
    } finally {
      setBusy(null);
    }
  }

  // 가벼운 토글(별표·선택·레퍼런스 선택)은 전역 busy에 잡지 않는다 — 긴 생성 작업 중에도 조작 가능
  async function runQuiet(label: string, fn: () => Promise<Response>) {
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
    }
  }

  if (!state) {
    return <p className="text-sm text-fg2">{error || "불러오는 중…"}</p>;
  }

  const { brief, references, concepts, svgs, evaluations, mockups, engines } = state;
  const directions = brief?.content.directions ?? [];
  const selectedConcepts = concepts.filter((c) => c.selected);
  const latestEval = (conceptId: string) => evaluations.find((e) => e.concept_id === conceptId);
  const svgsOf = (conceptId: string) => svgs.filter((s) => s.concept_id === conceptId);

  // 예상 API 비용 (추정 단가 — 시안: 구성 $0.08 + 고품질 이미지 2장 $0.25, 평가 $0.10, SVG $0.12, 목업 $0.15)
  const estCost =
    (brief ? 0.15 : 0) + concepts.length * 0.33 + evaluations.length * 0.1 + svgs.length * 0.12 + mockups.length * 0.15;

  // 시안 필터·정렬 적용 (생성순 정렬은 원래 순서 유지 — stable sort)
  const visibleConcepts = concepts
    .filter(
      (c) =>
        (!cFilter.dir || c.direction === cFilter.dir) &&
        (!cFilter.round || String(c.round) === cFilter.round) &&
        (!cFilter.starred || c.starred || c.selected)
    )
    .sort((a, b) =>
      cFilter.sort === "score" ? (latestEval(b.id)?.total ?? -1) - (latestEval(a.id)?.total ?? -1) : 0
    );

  const toggleCompare = (id: string) =>
    setCompareIds((ids) => {
      if (ids.includes(id)) return ids.filter((x) => x !== id);
      if (ids.length >= 4) {
        flashNotice("⚖ 비교는 최대 4개까지 담을 수 있습니다 — 먼저 하나를 빼주세요");
        return ids;
      }
      return [...ids, id];
    });

  // 미평가 시안 일괄 평가 (순차 실행) — 서버에서 최신 목록을 다시 받아 대상 산정
  async function evaluateAll() {
    setError("");
    const fresh = await fetch(`/api/admin/pipeline/${sessionId}`);
    if (!fresh.ok) return;
    const st = (await fresh.json()) as State;
    const targets = st.concepts.filter((c) => !st.evaluations.some((e) => e.concept_id === c.id));
    if (!targets.length) {
      setBusy(null);
      return;
    }
    for (let i = 0; i < targets.length; i++) {
      setBusy(`모두 평가 (${i + 1}/${targets.length})`);
      try {
        const res = await fetch(`/api/admin/pipeline/evaluate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ concept_id: targets[i].id }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setError(`${i + 1}번째 평가 실패: ${d.error ?? "오류"}`);
        }
      } catch {
        setError(`${i + 1}번째 평가 중 오류`);
      }
      await load();
    }
    setBusy(null);
    flashNotice(`✅ 모두 평가 완료 (${targets.length}건)`);
  }

  // 파이프라인 재시작: 정리 + 기각 사유 기록 → 사유를 반영한 브리프 재생성 (2단계 체인)
  async function restartPipeline(feedback: string) {
    setBusy("파이프라인 재시작");
    setError("");
    try {
      const r1 = await fetch(`/api/admin/pipeline/${sessionId}/restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "restart", feedback }),
      });
      if (!r1.ok) {
        const d = await r1.json().catch(() => ({}));
        setError(d.error ?? "재시작 실패");
        return;
      }
      setBusy("브리프 재생성 (기각 사유 반영)");
      const r2 = await fetch(`/api/admin/pipeline/${sessionId}/brief`, { method: "POST" });
      if (!r2.ok) {
        const d = await r2.json().catch(() => ({}));
        setError(d.error ?? "브리프 재생성 실패 — 브리프 탭에서 [재생성]을 눌러주세요.");
      } else {
        flashNotice("✅ 재시작 완료 — 기각 사유가 반영된 새 브리프가 생성되었습니다");
      }
    } catch {
      setError("재시작 중 오류가 발생했습니다.");
    } finally {
      setBusy(null);
      await load();
    }
  }

  // 전 방향 일괄 서치 (순차): 방향마다 Behance + AI 웹서치 실행, 실패 건은 건너뛰고 요약
  async function searchAll() {
    const jobs = directions.flatMap((d) => [
      { d: d.name, source: "behance" as const, label: "Behance" },
      ...(engines.includes("gemini") ? [{ d: d.name, source: undefined, label: "AI" }] : []),
    ]);
    if (!jobs.length) return;
    setError("");
    const fails: string[] = [];
    for (let i = 0; i < jobs.length; i++) {
      setBusy(`모두 서치 (${i + 1}/${jobs.length})`);
      try {
        const res = await fetch(`/api/admin/pipeline/${sessionId}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ direction: jobs[i].d, ...(jobs[i].source ? { source: jobs[i].source } : {}) }),
        });
        if (!res.ok) fails.push(`${jobs[i].d}(${jobs[i].label})`);
      } catch {
        fails.push(`${jobs[i].d}(${jobs[i].label})`);
      }
      await load();
    }
    setBusy(null);
    if (fails.length) setError(`서치 실패 ${fails.length}건: ${fails.join(", ")}`);
    else flashNotice(`✅ 모두 서치 완료 (${jobs.length}건)`);
  }

  // 방향×엔진 전 조합 일괄 생성 (순차) — 실패 건은 건너뛰고 요약, 옵션에 따라 자동 평가로 이어감
  async function generateAll() {
    const combos = directions.flatMap((d) => engines.map((e) => ({ d: d.name, e })));
    if (!combos.length) return;
    setError("");
    const fails: string[] = [];
    for (let i = 0; i < combos.length; i++) {
      setBusy(`모두 생성 (${i + 1}/${combos.length})`);
      try {
        const res = await fetch(`/api/admin/pipeline/${sessionId}/concepts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            direction: combos[i].d,
            engine: combos[i].e,
            refine: selfRefine,
            options: {
              logo_type: genOpts.logo_type || undefined,
              color_hint: genOpts.color_hint || undefined,
              extra: genOpts.extra || undefined,
              geometry: genOpts.geometry || undefined,
            },
          }),
        });
        if (!res.ok) fails.push(`${combos[i].d}(${engineLabel(combos[i].e)})`);
      } catch {
        fails.push(`${combos[i].d}(${engineLabel(combos[i].e)})`);
      }
      await load();
    }
    setBusy(null);
    if (fails.length) setError(`생성 실패 ${fails.length}건: ${fails.join(", ")}`);
    else flashNotice(`✅ 모두 생성 완료 (${combos.length}건)`);
    if (autoEval) await evaluateAll();
  }

  return (
    <div className="section-enter space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {state.session ? (
          <Link href={`/admin/s/${sessionId}`} className="link-quiet">← 응답 보기</Link>
        ) : (
          <Link href="/admin/design" className="link-quiet">← 디자인 목록</Link>
        )}
        <span className="flex items-center gap-3">
          {estCost > 0 && (
            <button
              className="text-xs text-hint hover:text-fg2"
              onClick={() => flashNotice(`💰 추정 단가 — 시안 $0.33 · 평가 $0.10 · SVG $0.12 · 목업 $0.15 · 브리프 $0.15 (셀프 리파인 시 시안당 ~2배, 대략치)`)}
              title="누르면 산정 근거를 표시합니다"
            >
              💰 예상 비용 ≈ ${estCost.toFixed(2)}
            </button>
          )}
          {(svgs.length > 0 || concepts.length > 0) && (
            <a href={`/api/admin/pipeline/${sessionId}/export`} className="btn btn-ghost !min-h-8 !px-4 !py-1 text-xs">
              📦 결과 내보내기 (ZIP)
            </a>
          )}
        </span>
      </div>

      <div>
        <h1 className="text-3xl text-fg">디자인 기획 파이프라인</h1>
        <p className="mt-2 text-sm text-fg2">
          {state.session
            ? `${state.session.iv_questionnaires?.title} · ${state.session.respondent_name}`
            : `🎨 애셋 프로젝트 — ${state.project?.title} · ${state.project?.brand_name}`}
        </p>
        {state.project && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {state.project.asset_urls.map((u, i) => (
              <img key={i} src={u} alt={`원본 애셋 ${i + 1}`} className="h-14 rounded-(--radius-xs) border border-line bg-white p-1" />
            ))}
            {state.project.key_colors.map((hex) => (
              <span key={hex} title={hex} className="inline-block h-6 w-6 rounded-full border border-line" style={{ background: hex }} />
            ))}
            {state.project.goal && <span className="text-xs text-fg2">{state.project.goal}</span>}
          </div>
        )}
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
              onClick={() => changeTab(t.key)}
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
              <p className="text-sm text-fg2">
                {state.session
                  ? "인터뷰 답변을 분석해 포지셔닝·키워드·디자인 방향·서치 쿼리를 생성합니다."
                  : "업로드한 원본 로고 애셋과 키컬러·목표를 분석해 베리에이션 방향·서치 쿼리를 생성합니다."}
              </p>
              <button
                onClick={() => run("브리프 생성", () => fetch(`/api/admin/pipeline/${sessionId}/brief`, { method: "POST" }))}
                disabled={!!busy || !state.claudeReady}
                className="btn btn-primary mt-4"
              >
                브리프 생성
              </button>
            </div>
          ) : editingBrief ? (
            <BriefEditor
              initial={brief.content}
              busy={!!busy}
              onCancel={() => setEditingBrief(false)}
              onSave={(content) => {
                setEditingBrief(false);
                run("브리프 수정", () => fetch(`/api/admin/pipeline/${sessionId}/brief`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ content }),
                }));
              }}
            />
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
                  <h2 className="flex items-center gap-2 text-xl text-fg">{d.name} {originBadge(d.origin)}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-fg2">{d.concept}</p>
                  <p className="mt-2 text-xs text-fg2">무드: {d.mood.join(" · ")}</p>
                  <div className="mt-3 space-y-1">
                    {d.search_queries.map((q) => (
                      <p key={q} className="rounded-(--radius-xs) bg-base/40 px-3 py-1.5 font-mono text-xs text-fg2">{q}</p>
                    ))}
                  </div>
                </div>
              ))}
              <DirectionExpand
                busy={!!busy}
                onExpand={(mode, note) =>
                  run(mode === "counter" ? "역제안 방향 생성" : "아이디어 방향 확장", () =>
                    fetch(`/api/admin/pipeline/${sessionId}/brief/expand`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ mode, note }),
                    })
                  )
                }
              />

              <div className="flex gap-2">
                <button onClick={() => setEditingBrief(true)} disabled={!!busy} className="btn btn-ghost">
                  ✏️ 직접 수정
                </button>
                <button
                  onClick={() => confirm("브리프를 다시 생성할까요? 기존 내용은 교체됩니다 (레퍼런스·시안은 유지).") && run("브리프 재생성", () => fetch(`/api/admin/pipeline/${sessionId}/brief`, { method: "POST" }))}
                  disabled={!!busy}
                  className="btn btn-ghost"
                >
                  재생성
                </button>
              </div>

              <RestartPanel
                brief={brief}
                keepCount={concepts.filter((c) => c.starred || c.selected).length}
                dropCount={concepts.filter((c) => !c.starred && !c.selected).length}
                sessionId={sessionId}
                busy={!!busy}
                onRestart={restartPipeline}
              />
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
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl text-fg">벤치마크 서치</h2>
                    <p className="mt-1 text-[13px] text-fg2">방향별 자동 쿼리 또는 직접 입력으로 실제 브랜드 사례를 수집합니다. Pinterest는 제외됩니다.</p>
                  </div>
                  <button
                    onClick={searchAll}
                    disabled={!!busy || directions.length === 0}
                    className="btn btn-primary shrink-0"
                  >
                    {busy?.startsWith("모두 서치") ? `⏳ ${busy}` : `🔍 모두 서치 (${directions.length}개 방향 전체)`}
                  </button>
                </div>
                <div className="mt-4 space-y-2">
                  {directions.map((d) => (
                    <div key={d.name} className="flex flex-wrap items-center gap-2">
                      <span className="flex min-w-32 items-center gap-1.5 text-sm font-semibold text-fg">{d.name} {originBadge(d.origin)}</span>
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
                <ManualRefAdd
                  disabled={!!busy}
                  onAdd={(url) => run("레퍼런스 직접 추가", () => fetch(`/api/admin/pipeline/${sessionId}/search`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ query: url, source: "manual" }),
                  }))}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {references.map((r) => (
                  <div key={r.id} className={`card !p-4 ${r.selected ? "!border-inv" : ""}`}>
                    <a href={r.url ?? "#"} target="_blank" rel="noreferrer">
                      <RefImage
                        src={r.image_path ? `/api/admin/pipeline/references/${r.id}/img` : r.image_url}
                        name={r.brand_name}
                      />
                    </a>
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
                        onClick={() => runQuiet("선택", () => fetch(`/api/admin/pipeline/references/${r.id}`, {
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
              <p className="text-xs text-hint">※ 수집 이미지는 참고용입니다. 저작물을 직접 사용하지 마세요.</p>
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
              {/* 회차 관리 */}
              <div className="card !py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="badge badge-done">🔄 {brief?.current_round ?? 1}회차 진행 중</span>
                    {(brief?.round_feedback?.length ?? 0) > 0 && (
                      <span className="ml-2 text-xs text-fg2">
                        직전 피드백: {brief!.round_feedback[brief!.round_feedback.length - 1].feedback.slice(0, 60)}
                      </span>
                    )}
                  </div>
                  <NextRound
                    disabled={!!busy || !concepts.some((c) => c.round === (brief?.current_round ?? 1) && c.selected)}
                    hint={
                      concepts.some((c) => c.round === (brief?.current_round ?? 1) && c.selected)
                        ? ""
                        : "이번 회차 시안을 선택하면 다음 회차를 시작할 수 있습니다"
                    }
                    onStart={(fb) => run("다음 회차 시작", () => fetch(`/api/admin/pipeline/${sessionId}/round`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ feedback: fb }),
                    }))}
                  />
                </div>
                <p className="mt-2 text-xs text-hint">
                  다음 회차부터는 이전 회차에서 <strong className="text-fg2">선택한 시안을 기반으로 발전·정제</strong>됩니다 (피드백 최우선 반영).
                </p>
              </div>

              <div className="card">
                <h2 className="text-xl text-fg">시안 생성</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-fg2">
                  아래 행은 브리프의 <strong className="text-fg">디자인 방향</strong>입니다. 선택한 레퍼런스{" "}
                  <strong className="text-fg">{references.filter((r) => r.selected).length}개는 모두</strong> 각 생성에 반영되며,
                  같은 방향을 다시 생성하면 이전 시안과 <strong className="text-fg">다른 조형 접근</strong>으로 만들어집니다.
                </p>

                {/* 생성 옵션 */}
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <select
                    value={genOpts.logo_type}
                    onChange={(e) => setGenOpts((o) => ({ ...o, logo_type: e.target.value }))}
                    className="select"
                    aria-label="로고 유형"
                  >
                    <option value="">로고 유형 — 자동</option>
                    <option value="심볼 마크">심볼 마크 중심</option>
                    <option value="워드마크(로고타입)">워드마크 중심</option>
                    <option value="심볼+워드마크 콤비네이션">심볼+워드마크 콤비</option>
                    <option value="엠블럼/배지형">엠블럼·배지형</option>
                    <option value="이니셜/모노그램">이니셜·모노그램</option>
                  </select>
                  <select
                    value={genOpts.geometry}
                    onChange={(e) => setGenOpts((o) => ({ ...o, geometry: e.target.value }))}
                    className="select"
                    aria-label="비례 체계"
                    title="시안의 기하학적 구성 원칙 — SVG 재작성 시에도 반영됩니다"
                  >
                    <option value="">비례 체계 — 자동</option>
                    <option value="golden">황금비 (1:1.618)</option>
                    <option value="grid">정수비 그리드</option>
                  </select>
                  <input
                    value={genOpts.color_hint}
                    onChange={(e) => setGenOpts((o) => ({ ...o, color_hint: e.target.value }))}
                    placeholder="컬러 지시 — 예: 딥그린+아이보리, #1B4D3E 계열"
                    className="input"
                  />
                  <input
                    value={genOpts.extra}
                    onChange={(e) => setGenOpts((o) => ({ ...o, extra: e.target.value }))}
                    placeholder="추가 요청 — 예: 곡선 위주, 한글 포함"
                    className="input"
                  />
                </div>

                <div className="mt-4 space-y-2">
                  {directions.map((d) => (
                    <div key={d.name} className="flex flex-wrap items-center gap-2">
                      <span className="flex min-w-32 items-center gap-1.5 text-sm font-semibold text-fg">{d.name} {originBadge(d.origin)}</span>
                      {engines.map((e) => {
                        const label = `${d.name} 시안 (${engineLabel(e)})`;
                        const running = busy === label;
                        return (
                          <button
                            key={e}
                            onClick={() => run(label, () => fetch(`/api/admin/pipeline/${sessionId}/concepts`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                direction: d.name,
                                engine: e,
                                refine: selfRefine,
                                options: {
                                  logo_type: genOpts.logo_type || undefined,
                                  color_hint: genOpts.color_hint || undefined,
                                  extra: genOpts.extra || undefined,
                                  geometry: genOpts.geometry || undefined,
                                },
                              }),
                            }))}
                            disabled={!!busy}
                            className={`btn !min-h-9 !py-1.5 text-xs ${running ? "btn-primary" : "btn-ghost"}`}
                          >
                            {running ? "⏳ 생성 중…" : `🎨 ${engineLabel(e)}로 생성`}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {/* 일괄 생성 */}
                <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-line pt-4">
                  <button
                    onClick={generateAll}
                    disabled={!!busy || engines.length === 0 || directions.length === 0}
                    className="btn btn-primary"
                  >
                    {busy?.startsWith("모두 생성") ? `⏳ ${busy}` : `▶ 모두 생성 (방향 ${directions.length} × 엔진 ${engines.length} = ${directions.length * engines.length}건)`}
                  </button>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-fg2">
                    <input
                      type="checkbox"
                      checked={autoEval}
                      onChange={(e) => setAutoEval(e.target.checked)}
                      className="h-4 w-4 accent-(--key)"
                    />
                    생성 후 자동 평가
                  </label>
                  <label
                    className="flex cursor-pointer items-center gap-2 text-sm text-fg2"
                    title="1차 결과를 AI 아트 디렉터가 비평 → 부족하면 프롬프트를 고쳐 1회 재생성합니다. 시안당 비용·시간 약 2배"
                  >
                    <input
                      type="checkbox"
                      checked={selfRefine}
                      onChange={(e) => setSelfRefine(e.target.checked)}
                      className="h-4 w-4 accent-(--key)"
                    />
                    ✨ 셀프 리파인 (비용 ~2배)
                  </label>
                </div>
                {engines.length === 0 && <p className="mt-3 text-sm text-danger">⚠️ OPENAI_API_KEY / GEMINI_API_KEY가 없어 이미지 생성을 사용할 수 없습니다.</p>}
              </div>

              {concepts.length > 0 && (
                <p className="text-xs text-hint">
                  ⭐ 별표 = 남길 시안 표시 (정리·다시 시작 때 보존) · 선택 = SVG 생성과 다음 회차의 기준 · ⚖ 비교 = 최대 4개 나란히 보기
                </p>
              )}

              {/* 시안 필터·정렬 */}
              {concepts.length > 1 && (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={cFilter.dir}
                    onChange={(e) => setCFilter((f) => ({ ...f, dir: e.target.value }))}
                    className="select !min-h-9 w-auto !py-1.5 text-xs"
                    aria-label="방향 필터"
                  >
                    <option value="">방향 전체</option>
                    {[...new Set(concepts.map((c) => c.direction))].map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <select
                    value={cFilter.round}
                    onChange={(e) => setCFilter((f) => ({ ...f, round: e.target.value }))}
                    className="select !min-h-9 w-auto !py-1.5 text-xs"
                    aria-label="회차 필터"
                  >
                    <option value="">회차 전체</option>
                    {[...new Set(concepts.map((c) => c.round))].sort((a, b) => a - b).map((r) => (
                      <option key={r} value={String(r)}>{r}회차</option>
                    ))}
                  </select>
                  <button
                    onClick={() => setCFilter((f) => ({ ...f, starred: !f.starred }))}
                    className={`btn !min-h-9 !px-3 !py-1.5 text-xs ${cFilter.starred ? "btn-primary" : "btn-ghost"}`}
                  >
                    ⭐·선택만
                  </button>
                  <select
                    value={cFilter.sort}
                    onChange={(e) => setCFilter((f) => ({ ...f, sort: e.target.value as "recent" | "score" }))}
                    className="select !min-h-9 w-auto !py-1.5 text-xs"
                    aria-label="정렬"
                  >
                    <option value="recent">생성순</option>
                    <option value="score">점수순</option>
                  </select>
                </div>
              )}
              {concepts.length > 0 && concepts.some((c) => !c.starred && !c.selected) && (
                <div className="flex items-center justify-end gap-2">
                  <span className="text-xs text-hint">
                    ⭐ 별표·선택 {concepts.filter((c) => c.starred || c.selected).length}개 보존
                  </span>
                  <button
                    onClick={() => {
                      const dropN = concepts.filter((c) => !c.starred && !c.selected).length;
                      if (confirm(`⭐ 별표·선택 표시가 없는 시안 ${dropN}개를 삭제할까요? (브리프·레퍼런스·회차는 유지됩니다)`)) {
                        run("시안 정리", () => fetch(`/api/admin/pipeline/${sessionId}/restart`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ mode: "prune" }),
                        }));
                      }
                    }}
                    disabled={!!busy}
                    className="btn btn-ghost !min-h-8 !px-3 !py-1 text-xs"
                  >
                    🧹 별표·선택만 남기고 정리 ({concepts.filter((c) => !c.starred && !c.selected).length}개 삭제)
                  </button>
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {visibleConcepts.map((c) => (
                  <div key={c.id} className={`card !p-4 ${c.selected ? "!border-inv" : ""}`}>
                    <div className="grid grid-cols-2 gap-2">
                      <img src={`/api/admin/pipeline/concepts/${c.id}/file?mode=light`} alt="라이트" className="w-full rounded-(--radius-xs) bg-white" loading="lazy" />
                      <img src={`/api/admin/pipeline/concepts/${c.id}/file?mode=dark`} alt="다크" className="w-full rounded-(--radius-xs) bg-black" loading="lazy" />
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 text-xs">
                      <a href={`/api/admin/pipeline/concepts/${c.id}/file?mode=light&dl=1`} className="link-quiet">⬇ 라이트 PNG</a>
                      <a href={`/api/admin/pipeline/concepts/${c.id}/file?mode=dark&dl=1`} className="link-quiet">⬇ 다크 PNG</a>
                      <button
                        onClick={() => confirm("이 시안을 삭제할까요? 연결된 SVG·평가·목업도 함께 삭제되며 복구할 수 없습니다.") && run("삭제", () => fetch(`/api/admin/pipeline/concepts/${c.id}`, { method: "DELETE" }))}
                        className="link-quiet ml-auto !text-danger/70 hover:!text-danger"
                      >
                        삭제
                      </button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => runQuiet("별표", () => fetch(`/api/admin/pipeline/concepts/${c.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ starred: !c.starred }),
                        }))}
                        className={`text-lg leading-none ${c.starred ? "" : "opacity-30 hover:opacity-70"}`}
                        title="남길 시안 표시 — 정리·재시작 시 보존됩니다"
                        aria-label={c.starred ? "별표 해제" : "별표"}
                      >
                        ⭐
                      </button>
                      <span className="badge badge-pending">{c.direction}</span>
                      <span className="badge badge-pending" title={c.gen_model ?? undefined}>{c.round}회차 · {engineLabel(c.engine)} #{c.version}</span>
                      {c.engine === "gemini" && c.gen_model?.includes("2.5-flash") && (
                        <span className="badge badge-progress" title={`상위 모델 실패로 하위 모델로 생성됨 (${c.gen_model})`}>⚠ flash</span>
                      )}
                      {latestEval(c.id) && <span className="badge badge-done">{latestEval(c.id)!.total}점</span>}
                      {(c.palette ?? []).map((hex) => (
                        <span key={hex} title={hex} className="inline-block h-5 w-5 rounded-full border border-line" style={{ background: hex }} />
                      ))}
                      <span className="ml-auto flex flex-wrap gap-2">
                        <button
                          onClick={() => toggleCompare(c.id)}
                          className={`btn !min-h-8 !px-3 !py-1 text-xs ${compareIds.includes(c.id) ? "btn-primary" : "btn-ghost"}`}
                          title="나란히 비교에 추가 (최대 4개)"
                        >
                          ⚖ 비교
                        </button>
                        <button
                          onClick={() => run(`변형 생성 (${c.direction})`, () => fetch(`/api/admin/pipeline/${sessionId}/concepts`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ variant_of: c.id }),
                          }))}
                          disabled={!!busy}
                          className="btn btn-ghost !min-h-8 !px-3 !py-1 text-xs"
                          title="핵심 조형은 유지하고 디테일만 달리한 변형을 1개 생성합니다"
                        >
                          {busy === `변형 생성 (${c.direction})` ? "⏳ 변형 중…" : "🔁 비슷하게 변형"}
                        </button>
                        <button
                          onClick={() => runQuiet("선택", () => fetch(`/api/admin/pipeline/concepts/${c.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ selected: !c.selected }),
                          }))}
                          className={`btn !min-h-8 !px-3 !py-1 text-xs ${c.selected ? "btn-primary" : "btn-ghost"}`}
                          title="SVG 생성 대상이자 다음 회차의 발전 기반이 됩니다"
                        >
                          {c.selected ? "✓ 선택됨 (SVG·회차)" : "선택 (SVG·회차)"}
                        </button>
                      </span>
                    </div>
                    {c.rationale && (
                      <p className="mt-3 rounded-(--radius-xs) bg-base/40 px-3 py-2 text-[13px] leading-relaxed text-fg2">
                        <strong className="text-fg">제작 의도</strong> — {c.rationale}
                      </p>
                    )}
                    <PromptView
                      prompt={c.prompt}
                      busy={!!busy}
                      onRegen={(p) => run(`프롬프트 재생성 (${c.direction})`, () => fetch(`/api/admin/pipeline/${sessionId}/concepts`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ direction: c.direction, engine: c.engine, prompt_override: p }),
                      }))}
                    />
                  </div>
                ))}
              </div>
              {concepts.length === 0 && <p className="text-center text-sm text-fg2">아직 생성된 시안이 없습니다.</p>}
              {concepts.length > 0 && visibleConcepts.length === 0 && (
                <p className="text-center text-sm text-fg2">필터 조건에 맞는 시안이 없습니다.</p>
              )}
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
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl text-fg">AI 평가</h2>
                    <p className="mt-1 text-[13px] text-fg2">
                      독립 리뷰 보드 관점으로 채점 —{" "}
                      {(brief?.criteria ?? DEFAULT_CRITERIA).map((c) => `${c.criterion}(${c.weight})`).join(" · ")}
                      {brief?.criteria && <span className="ml-1 badge badge-progress">커스텀</span>}
                    </p>
                  </div>
                  <span className="flex shrink-0 gap-2">
                    <button
                      onClick={() => setEditingCriteria((v) => !v)}
                      disabled={!!busy}
                      className="btn btn-ghost !min-h-9 !py-1.5 text-xs"
                    >
                      {editingCriteria ? "✕ 닫기" : "⚙ 기준 편집"}
                    </button>
                    <button
                      onClick={evaluateAll}
                      disabled={!!busy || !state.claudeReady || concepts.every((c) => !!latestEval(c.id))}
                      className="btn btn-primary"
                    >
                      {busy?.startsWith("모두 평가") ? `⏳ ${busy}` : `▶ 모두 평가하기 (미평가 ${concepts.filter((c) => !latestEval(c.id)).length}개)`}
                    </button>
                  </span>
                </div>
                {editingCriteria && brief && (
                  <CriteriaEditor
                    initial={brief.criteria ?? DEFAULT_CRITERIA}
                    isCustom={!!brief.criteria}
                    busy={!!busy}
                    onSave={(criteria) => {
                      setEditingCriteria(false);
                      run("평가 기준 저장", () => fetch(`/api/admin/pipeline/${sessionId}/brief`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ criteria }),
                      }));
                    }}
                    onReset={() => {
                      setEditingCriteria(false);
                      run("기본 기준 복원", () => fetch(`/api/admin/pipeline/${sessionId}/brief`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ criteria: null }),
                      }));
                    }}
                  />
                )}
                <p className="mt-2 text-xs text-hint">
                  ※ 기준 변경은 이후 평가부터 적용됩니다. 기존 평가 결과는 그대로 보존됩니다.
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
                          <span className="min-w-0 flex-1 truncate text-fg">{c.direction} · {c.round}회차 · {engineLabel(c.engine)} #{c.version}</span>
                          <span className="font-bold text-fg">{e!.total}점</span>
                          {svgsOf(c.id).length > 0 ? (
                            <a
                              href={`/api/admin/pipeline/svg/${svgsOf(c.id)[svgsOf(c.id).length - 1].id}`}
                              className="btn btn-ghost !min-h-7 !px-3 !py-0.5 text-xs"
                            >
                              ⬇ SVG
                            </a>
                          ) : (
                            <span className="text-xs text-hint">SVG 없음</span>
                          )}
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
                          <p className="text-sm font-bold text-fg">{c.direction} · {c.round}회차 · {engineLabel(c.engine)} #{c.version}</p>
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
                            onClick={() => runQuiet("선택", () => fetch(`/api/admin/pipeline/concepts/${c.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ selected: !c.selected }),
                            }))}
                            className={`btn !min-h-8 !py-1 text-xs ${c.selected ? "btn-primary" : "btn-ghost"}`}
                            title="SVG 생성 대상이자 다음 회차의 발전 기반이 됩니다"
                          >
                            {c.selected ? "✓ 선택됨 (SVG·회차)" : "선택 (SVG·회차)"}
                          </button>
                          <button
                            onClick={() => toggleCompare(c.id)}
                            className={`btn !min-h-8 !py-1 text-xs ${compareIds.includes(c.id) ? "btn-primary" : "btn-ghost"}`}
                          >
                            ⚖ 비교
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
              <p className="text-xs text-hint">※ AI 평가는 참고용 1차 스크리닝입니다. 최종 선정은 대표와의 합의 기준으로 결정하세요.</p>
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
                      ⬡ {c.direction} · {c.round}회차 · {engineLabel(c.engine)} #{c.version} → SVG
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
                            onClick={() => confirm("이 SVG 버전을 삭제할까요? 복구할 수 없습니다.") && run("삭제", () => fetch(`/api/admin/pipeline/svg/${s.id}`, { method: "DELETE" }))}
                            className="link-quiet !text-danger/70 hover:!text-danger"
                          >
                            삭제
                          </button>
                        </span>
                      </div>
                      <SvgColorEditor
                        key={s.id + s.svg.length}
                        original={s.svg}
                        busy={!!busy}
                        onSave={(edited) => run("SVG 컬러 저장", () => fetch(`/api/admin/pipeline/svg/${s.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ svg: edited }),
                        }))}
                      />
                    </div>
                  );
                })}
              </div>
              {svgs.length === 0 && <p className="text-center text-sm text-fg2">아직 생성된 SVG가 없습니다.</p>}

              {/* 목업 미리보기 */}
              <div className="card">
                <h2 className="text-xl text-fg">목업 미리보기</h2>
                <p className="mt-1 text-[13px] text-fg2">선택된 시안을 실제 매체에 합성해 확인합니다. (시안 이미지 기반 AI 합성)</p>
                <div className="mt-4 space-y-2">
                  {selectedConcepts.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center gap-2">
                      <span className="min-w-40 text-sm font-semibold text-fg">
                        {c.direction} · {c.round}회차 · {engineLabel(c.engine)} #{c.version}
                      </span>
                      {MOCKUP_KINDS.map((k) => {
                        const label = `목업 (${k.label})`;
                        return (
                          <button
                            key={k.kind}
                            onClick={() => run(label, () => fetch(`/api/admin/pipeline/mockups`, {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ concept_id: c.id, kind: k.kind }),
                            }))}
                            disabled={!!busy || engines.length === 0}
                            className={`btn !min-h-9 !py-1.5 text-xs ${busy === label ? "btn-primary" : "btn-ghost"}`}
                          >
                            {busy === label ? "⏳ 합성 중…" : `${k.label} 생성`}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
                {mockups.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {mockups.map((m) => {
                      const parent = concepts.find((c) => c.id === m.concept_id);
                      return (
                        <div key={m.id} className="min-w-0">
                          <img
                            src={`/api/admin/pipeline/mockups/${m.id}`}
                            alt={mockupLabel(m.kind)}
                            className="w-full rounded-(--radius-xs) border border-line bg-white"
                            loading="lazy"
                          />
                          <div className="mt-1.5 flex items-center gap-2 text-xs">
                            <span className="badge badge-pending">{mockupLabel(m.kind)}</span>
                            <span className="truncate text-hint">{parent?.direction ?? ""}</span>
                            <span className="ml-auto flex gap-2">
                              <a href={`/api/admin/pipeline/mockups/${m.id}?dl=1`} className="link-quiet">⬇</a>
                              <button
                                onClick={() => confirm("이 목업을 삭제할까요? 복구할 수 없습니다.") && run("삭제", () => fetch(`/api/admin/pipeline/mockups/${m.id}`, { method: "DELETE" }))}
                                className="link-quiet !text-danger/70 hover:!text-danger"
                              >
                                ✕
                              </button>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {/* 하단 단계 이동 */}
      {(() => {
        const idx = TABS.findIndex((t) => t.key === tab);
        const go = (t: Tab) => {
          changeTab(t);
          window.scrollTo({ top: 0, behavior: "smooth" });
        };
        return (
          <div className="flex items-center justify-between border-t border-line pt-5">
            {idx > 0 ? (
              <button onClick={() => go(TABS[idx - 1].key)} className="btn btn-ghost">
                ← 이전: {TABS[idx - 1].label.replace(/^\d+\. /, "")}
              </button>
            ) : (
              <span />
            )}
            {idx < TABS.length - 1 ? (
              <button onClick={() => go(TABS[idx + 1].key)} className="btn btn-primary">
                다음: {TABS[idx + 1].label.replace(/^\d+\. /, "")} →
              </button>
            ) : (
              <span />
            )}
          </div>
        );
      })()}

      {/* 비교 바가 떠 있을 때 하단 버튼이 가려지지 않도록 여백 확보 */}
      {compareIds.length > 0 && !showCompare && <div aria-hidden className="h-16" />}

      {/* 진행 상태 플로팅 레이어 — 스크롤과 무관하게 항상 보임 */}
      {busy && (
        <div className="pointer-events-none fixed top-4 left-1/2 z-50 -translate-x-1/2">
          <div className="card flex items-center gap-2.5 !rounded-full !px-5 !py-2.5 shadow-2xl">
            <span
              aria-hidden
              className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-inv border-t-transparent"
            />
            <span className="whitespace-nowrap text-sm font-semibold text-fg">
              ⏳ {busy} 진행 중… (최대 2~3분)
            </span>
          </div>
        </div>
      )}

      {/* 완료·안내 토스트 (진행 배지가 떠 있으면 그 아래에 표시) */}
      {notice && (
        <div className={`pointer-events-none fixed ${busy ? "top-18" : "top-4"} left-1/2 z-50 -translate-x-1/2`}>
          <div className="card !rounded-full !px-5 !py-2.5 shadow-2xl">
            <span className="whitespace-nowrap text-sm font-semibold text-fg">{notice}</span>
          </div>
        </div>
      )}

      {/* 비교 바 (하단 고정) */}
      {compareIds.length > 0 && !showCompare && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
          <div className="card flex items-center gap-3 !px-4 !py-2 shadow-2xl">
            <span className="whitespace-nowrap text-sm text-fg">⚖ 비교 {compareIds.length}/4</span>
            <button
              onClick={() => setShowCompare(true)}
              disabled={compareIds.length < 2}
              className="btn btn-primary !min-h-8 !px-4 !py-1 text-xs"
            >
              나란히 비교
            </button>
            <button onClick={() => setCompareIds([])} className="link-quiet text-xs">비우기</button>
          </div>
        </div>
      )}

      {/* 비교 뷰 오버레이 */}
      {showCompare && (
        <CompareView
          concepts={concepts.filter((c) => compareIds.includes(c.id))}
          latestEval={latestEval}
          onClose={() => setShowCompare(false)}
        />
      )}
    </div>
  );
}

// 시안 나란히 비교 — 라이트/다크·팔레트·평가·제작의도를 한 화면에서
function CompareView({
  concepts,
  latestEval,
  onClose,
}: {
  concepts: Concept[];
  latestEval: (id: string) => Evaluation | undefined;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="card max-h-[92vh] w-full max-w-6xl overflow-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="시안 비교"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl text-fg">시안 비교</h2>
          <button onClick={onClose} className="btn btn-ghost !min-h-8 !px-3 !py-1 text-xs">✕ 닫기</button>
        </div>
        <div
          className="mt-4 grid gap-5"
          style={{ gridTemplateColumns: `repeat(${concepts.length}, minmax(200px, 1fr))` }}
        >
          {concepts.map((c) => {
            const ev = latestEval(c.id);
            return (
              <div key={c.id} className="min-w-0">
                <img src={`/api/admin/pipeline/concepts/${c.id}/file?mode=light`} alt={`${c.direction} 라이트`} className="w-full rounded-(--radius-xs) bg-white" />
                <img src={`/api/admin/pipeline/concepts/${c.id}/file?mode=dark`} alt={`${c.direction} 다크`} className="mt-2 w-full rounded-(--radius-xs) bg-black" />
                <p className="mt-2 text-sm font-bold text-fg">{c.direction}</p>
                <p className="text-xs text-fg2">
                  {c.round}회차 · {engineLabel(c.engine)} #{c.version}{c.selected ? " · ✓ SVG 대상" : ""}
                </p>
                <div className="mt-1.5 flex gap-1">
                  {(c.palette ?? []).map((hex) => (
                    <span key={hex} title={hex} className="inline-block h-4 w-4 rounded-full border border-line" style={{ background: hex }} />
                  ))}
                </div>
                {ev ? (
                  <>
                    <p className="mt-2 text-xl font-bold text-inv">{ev.total}<span className="text-xs text-fg2"> / 100</span></p>
                    <div className="mt-1.5 space-y-1">
                      {ev.scores.map((s) => (
                        <div key={s.criterion} className="flex items-center gap-2 text-xs">
                          <span className="w-16 shrink-0 truncate text-fg2" title={s.criterion}>{s.criterion}</span>
                          <div className="h-1 min-w-8 flex-1 overflow-hidden rounded-full bg-fg2/10">
                            <div className="h-full rounded-full bg-inv" style={{ width: `${s.score * 10}%` }} />
                          </div>
                          <span className="w-5 shrink-0 text-right font-semibold text-fg">{s.score}</span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="mt-2 text-xs text-hint">아직 평가 없음</p>
                )}
                {c.rationale && (
                  <p className="mt-2 text-xs leading-relaxed text-fg2">{c.rationale}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// 다시 시작 (위험 구역) — 기각 사유 필수, ⭐·선택 시안은 보존, 사유는 새 브리프에 반영
function RestartPanel({
  brief,
  keepCount,
  dropCount,
  sessionId,
  busy,
  onRestart,
}: {
  brief: Brief;
  keepCount: number;
  dropCount: number;
  sessionId: string;
  busy: boolean;
  onRestart: (feedback: string) => void;
}) {
  const [fb, setFb] = useState("");
  const notes = brief.reset_notes ?? [];
  return (
    <div className="card !border-danger/25">
      <h2 className="text-xl text-fg">🧨 다시 시작</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-fg2">
        <strong className="text-fg">브리프의 해석 자체가 잘못됐을 때</strong> 사용하세요. 시안만 아쉽다면 다음 회차·셀프 리파인·역제안 방향을
        먼저 권합니다. 실행 시:
      </p>
      <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-fg2">
        <li>⭐ 별표·선택 시안 <strong className="text-fg">{keepCount}개 보존</strong>, 나머지 시안 {dropCount}개 삭제</li>
        <li>선택하지 않은 레퍼런스 삭제, 회차는 1회차로 리셋</li>
        <li>입력한 기각 사유를 <strong className="text-fg">반드시 피할 것</strong>으로 반영해 브리프를 새로 생성</li>
      </ul>
      {notes.length > 0 && (
        <div className="mt-3 rounded-(--radius-xs) bg-base/40 px-3 py-2 text-xs text-fg2">
          <strong className="text-fg">이전 기각 사유</strong>
          {notes.map((n, i) => (
            <p key={i} className="mt-1">
              {i + 1}. {n.feedback} <span className="text-hint">({new Date(n.created_at).toLocaleDateString("ko-KR")})</span>
            </p>
          ))}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={fb}
          onChange={(e) => setFb(e.target.value)}
          placeholder="무엇이 마음에 들지 않았나요? (필수) — 예: 전체적으로 너무 차분하고 병원스러움"
          className="input min-w-64 flex-1 !py-1.5 text-sm"
          disabled={busy}
        />
        <a
          href={`/api/admin/pipeline/${sessionId}/export`}
          className="btn btn-ghost shrink-0 !min-h-9 !py-1.5 text-xs"
          title="초기화 전 현재 결과를 ZIP으로 백업"
        >
          📦 백업
        </a>
        <button
          onClick={() =>
            confirm(`정말 다시 시작할까요?\n\n보존: ⭐·선택 시안 ${keepCount}개\n삭제: 시안 ${dropCount}개 + 미선택 레퍼런스\n\n삭제된 이미지는 복구할 수 없습니다.`) &&
            (onRestart(fb.trim()), setFb(""))
          }
          disabled={busy || !fb.trim()}
          className="btn shrink-0 !min-h-9 !py-1.5 text-xs !bg-danger/15 !text-danger hover:!bg-danger/25"
        >
          🧨 다시 시작
        </button>
      </div>
    </div>
  );
}

// 방향 확장 — 역제안(counter) / 아이디어 확장(seed)
function DirectionExpand({ busy, onExpand }: { busy: boolean; onExpand: (mode: "counter" | "seed", note: string) => void }) {
  const [counterNote, setCounterNote] = useState("");
  const [seed, setSeed] = useState("");
  return (
    <div className="card">
      <h2 className="text-xl text-fg">방향 추가</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-fg2">
        인터뷰 기반 방향이 시안으로 안 맞을 때 — AI가 지금까지의 시안·평가를 근거로{" "}
        <strong className="text-fg">의도적으로 다른 대안</strong>을 제안하거나, 직접 낸 아이디어를 방향으로 확장합니다.
      </p>
      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={counterNote}
            onChange={(e) => setCounterNote(e.target.value)}
            placeholder="현재 결과가 안 맞는 이유 (선택) — 예: 너무 차분함, 더 대담한 인상이 필요"
            className="input min-w-64 flex-1 !py-1.5 text-sm"
            disabled={busy}
          />
          <button
            onClick={() => { onExpand("counter", counterNote.trim()); setCounterNote(""); }}
            disabled={busy}
            className="btn btn-ghost shrink-0 !min-h-9 !py-1.5 text-xs"
          >
            🔄 역제안 방향 받기
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && seed.trim() && (onExpand("seed", seed.trim()), setSeed(""))}
            placeholder="아이디어 한 줄 — 예: 레트로 세리프 워드마크로, 수공예 느낌으로"
            className="input min-w-64 flex-1 !py-1.5 text-sm"
            disabled={busy}
          />
          <button
            onClick={() => { onExpand("seed", seed.trim()); setSeed(""); }}
            disabled={busy || !seed.trim()}
            className="btn btn-ghost shrink-0 !min-h-9 !py-1.5 text-xs"
          >
            💡 방향으로 확장
          </button>
        </div>
      </div>
    </div>
  );
}

// 다음 회차 시작 — 피드백 입력 후 실행
function NextRound({ disabled, hint, onStart }: { disabled: boolean; hint: string; onStart: (feedback: string) => void }) {
  const [open, setOpen] = useState(false);
  const [fb, setFb] = useState("");
  if (!open) {
    return (
      <span className="flex items-center gap-2">
        {hint && <span className="text-xs text-hint">{hint}</span>}
        <button onClick={() => setOpen(true)} disabled={disabled} className="btn btn-ghost !min-h-8 !px-4 !py-1 text-xs">
          다음 회차 시작 →
        </button>
      </span>
    );
  }
  return (
    <span className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <input
        value={fb}
        onChange={(e) => setFb(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && fb.trim() && (onStart(fb.trim()), setOpen(false), setFb(""))}
        placeholder="피드백 — 예: 심볼은 유지, 곡선을 더 부드럽게, 컬러는 딥그린으로"
        autoFocus
        className="input min-w-72 flex-1 !py-1.5 text-xs"
      />
      <button
        onClick={() => fb.trim() && (onStart(fb.trim()), setOpen(false), setFb(""))}
        disabled={!fb.trim()}
        className="btn btn-primary !min-h-8 !px-4 !py-1 text-xs"
      >
        시작
      </button>
      <button onClick={() => setOpen(false)} className="link-quiet">취소</button>
    </span>
  );
}

// 브리프 구조화 편집 폼
function BriefEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: Brief["content"];
  busy: boolean;
  onSave: (content: Brief["content"]) => void;
  onCancel: () => void;
}) {
  const [positioning, setPositioning] = useState(initial.positioning);
  const [keywords, setKeywords] = useState(initial.keywords.join(", "));
  const [anti, setAnti] = useState(initial.anti.join(", "));
  const [dirs, setDirs] = useState(
    initial.directions.map((d) => ({
      name: d.name,
      concept: d.concept,
      mood: (d.mood ?? []).join(", "),
      queries: (d.search_queries ?? []).join("\n"),
      origin: d.origin,
    }))
  );
  const split = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean);
  const setDir = (i: number, patch: Partial<(typeof dirs)[number]>) =>
    setDirs((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  return (
    <div className="card space-y-4">
      <h2 className="text-xl text-fg">브리프 수정</h2>
      <div>
        <label className="text-xs font-semibold text-fg2">포지셔닝</label>
        <textarea value={positioning} onChange={(e) => setPositioning(e.target.value)} rows={3} className="textarea mt-1 w-full" />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className="text-xs font-semibold text-fg2">키워드 (콤마 구분)</label>
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} className="input mt-1" />
        </div>
        <div>
          <label className="text-xs font-semibold text-fg2">피할 것 (콤마 구분)</label>
          <input value={anti} onChange={(e) => setAnti(e.target.value)} className="input mt-1" />
        </div>
      </div>
      {dirs.map((d, i) => (
        <div key={i} className="rounded-(--radius-xs) border border-line p-4">
          <div className="flex items-center justify-between gap-2">
            <input
              value={d.name}
              onChange={(e) => setDir(i, { name: e.target.value })}
              className="input flex-1 font-semibold"
              placeholder="방향 이름"
            />
            <button
              onClick={() => setDirs((ds) => ds.filter((_, j) => j !== i))}
              className="link-quiet shrink-0 !text-danger/70 hover:!text-danger"
            >
              방향 삭제
            </button>
          </div>
          <textarea
            value={d.concept}
            onChange={(e) => setDir(i, { concept: e.target.value })}
            rows={2}
            className="textarea mt-2 w-full"
            placeholder="컨셉 설명"
          />
          <input
            value={d.mood}
            onChange={(e) => setDir(i, { mood: e.target.value })}
            className="input mt-2"
            placeholder="무드 (콤마 구분)"
          />
          <textarea
            value={d.queries}
            onChange={(e) => setDir(i, { queries: e.target.value })}
            rows={2}
            className="textarea mt-2 w-full font-mono text-xs"
            placeholder="서치 쿼리 (줄바꿈 구분)"
          />
        </div>
      ))}
      <button
        onClick={() => setDirs((ds) => [...ds, { name: "", concept: "", mood: "", queries: "", origin: undefined }])}
        className="btn btn-ghost !min-h-9 !py-1.5 text-xs"
      >
        ＋ 방향 추가
      </button>
      <div className="flex gap-2 border-t border-line pt-4">
        <button
          onClick={() =>
            onSave({
              positioning: positioning.trim(),
              keywords: split(keywords),
              anti: split(anti),
              directions: dirs
                .filter((d) => d.name.trim())
                .map((d) => ({
                  name: d.name.trim(),
                  concept: d.concept.trim(),
                  mood: split(d.mood),
                  search_queries: d.queries.split("\n").map((q) => q.trim()).filter(Boolean),
                  ...(d.origin ? { origin: d.origin } : {}),
                })),
            })
          }
          disabled={busy || !positioning.trim()}
          className="btn btn-primary"
        >
          저장
        </button>
        <button onClick={onCancel} className="btn btn-ghost">취소</button>
      </div>
    </div>
  );
}

// 평가 기준 편집 — 가중치 합 100 검증
function CriteriaEditor({
  initial,
  isCustom,
  busy,
  onSave,
  onReset,
}: {
  initial: Criterion[];
  isCustom: boolean;
  busy: boolean;
  onSave: (criteria: Criterion[]) => void;
  onReset: () => void;
}) {
  const [rows, setRows] = useState(initial.map((c) => ({ ...c, hint: c.hint ?? "" })));
  const sum = rows.reduce((s, r) => s + (Number(r.weight) || 0), 0);
  const valid = rows.length > 0 && rows.every((r) => r.criterion.trim() && Number(r.weight) > 0) && sum === 100;
  const setRow = (i: number, patch: Partial<Criterion>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="mt-4 space-y-2 border-t border-line pt-4">
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <input
            value={r.criterion}
            onChange={(e) => setRow(i, { criterion: e.target.value })}
            placeholder="기준명"
            className="input !min-h-9 w-44 !py-1.5 text-sm"
          />
          <input
            type="number"
            value={r.weight}
            onChange={(e) => setRow(i, { weight: Number(e.target.value) })}
            min={1}
            max={100}
            className="input !min-h-9 w-20 !py-1.5 text-sm"
            aria-label="가중치"
          />
          <input
            value={r.hint}
            onChange={(e) => setRow(i, { hint: e.target.value })}
            placeholder="채점 힌트 (선택)"
            className="input !min-h-9 min-w-40 flex-1 !py-1.5 text-xs"
          />
          <button
            onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
            className="link-quiet !text-danger/70 hover:!text-danger"
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          onClick={() => setRows((rs) => [...rs, { criterion: "", weight: 10, hint: "" }])}
          className="btn btn-ghost !min-h-8 !px-3 !py-1 text-xs"
        >
          ＋ 기준 추가
        </button>
        <span className={`text-sm font-bold ${sum === 100 ? "text-fg" : "text-danger"}`}>합계 {sum}/100</span>
        <span className="ml-auto flex gap-2">
          {isCustom && (
            <button onClick={onReset} disabled={busy} className="btn btn-ghost !min-h-8 !px-3 !py-1 text-xs">
              기본값 복원
            </button>
          )}
          <button
            onClick={() => onSave(rows.map((r) => ({ criterion: r.criterion.trim(), weight: Number(r.weight), hint: r.hint.trim() || undefined })))}
            disabled={busy || !valid}
            className="btn btn-primary !min-h-8 !px-4 !py-1 text-xs"
          >
            기준 저장
          </button>
        </span>
      </div>
    </div>
  );
}

// 시안의 실제 프롬프트 열람 + 수정 재생성
function PromptView({ prompt, busy, onRegen }: { prompt: string; busy: boolean; onRegen: (p: string) => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(prompt);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="link-quiet mt-2 text-xs">프롬프트 보기 ▾</button>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      <button onClick={() => { setOpen(false); setEditing(false); }} className="link-quiet text-xs">프롬프트 접기 ▴</button>
      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            className="textarea w-full font-mono text-xs"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { setEditing(false); onRegen(draft.trim()); }}
              disabled={busy || !draft.trim()}
              className="btn btn-primary !min-h-8 !px-3 !py-1 text-xs"
            >
              이 프롬프트로 재생성
            </button>
            <button onClick={() => { setEditing(false); setDraft(prompt); }} className="link-quiet text-xs">취소</button>
          </div>
        </>
      ) : (
        <>
          <p className="max-h-40 overflow-auto rounded-(--radius-xs) bg-base/40 px-3 py-2 font-mono text-xs leading-relaxed text-fg2">
            {prompt}
          </p>
          <button onClick={() => { setDraft(prompt); setEditing(true); }} disabled={busy} className="btn btn-ghost !min-h-8 !px-3 !py-1 text-xs">
            ✏️ 수정해서 재생성
          </button>
        </>
      )}
    </div>
  );
}

// SVG 컬러 치환 — API 호출 없이 즉시 미리보기, 저장 시 새 버전 생성
function SvgColorEditor({
  original,
  busy,
  onSave,
}: {
  original: string;
  busy: boolean;
  onSave: (svg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [edited, setEdited] = useState(original);
  const colors = useMemo(
    () => Array.from(new Set((edited.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).map((c) => c.toLowerCase()))),
    [edited]
  );
  const changed = edited !== original;
  // <input type="color">는 #rrggbb만 지원 — 3자리 확장, 8자리 절삭
  const norm = (hex: string) => {
    const h = hex.slice(1);
    if (h.length === 3) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    if (h.length >= 6) return `#${h.slice(0, 6)}`;
    return "#000000";
  };
  const replace = (from: string, to: string) =>
    setEdited((s) => s.replace(new RegExp(from, "gi"), to.toLowerCase()));
  const dataUri = `data:image/svg+xml;base64,${typeof window !== "undefined" ? btoa(unescape(encodeURIComponent(edited))) : ""}`;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="link-quiet mt-2 text-xs">🎨 컬러 편집 ▾</button>
    );
  }
  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-fg">컬러 편집 — 색을 고르면 즉시 미리보기됩니다</span>
        <button onClick={() => { setOpen(false); setEdited(original); }} className="link-quiet text-xs">접기 ▴</button>
      </div>
      {changed && (
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center justify-center rounded-(--radius-xs) bg-white p-4">
            <img src={dataUri} alt="미리보기 라이트" className="max-h-24 w-full object-contain" />
          </div>
          <div className="flex items-center justify-center rounded-(--radius-xs) bg-black p-4">
            <img src={dataUri} alt="미리보기 다크" className="max-h-24 w-full object-contain" />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {colors.map((c) => (
          <label key={c} className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-2 py-1">
            <input
              type="color"
              defaultValue={norm(c)}
              onChange={(e) => replace(c, e.target.value)}
              className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0"
              aria-label={`${c} 변경`}
            />
            <span className="font-mono text-xs text-fg2">{c}</span>
          </label>
        ))}
        {colors.length === 0 && <span className="text-xs text-hint">치환 가능한 HEX 색상이 없습니다.</span>}
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onSave(edited)}
          disabled={busy || !changed}
          className="btn btn-primary !min-h-8 !px-3 !py-1 text-xs"
        >
          새 버전으로 저장
        </button>
        <button onClick={() => setEdited(original)} disabled={!changed} className="btn btn-ghost !min-h-8 !px-3 !py-1 text-xs">
          되돌리기
        </button>
      </div>
    </div>
  );
}

// 외부 CDN 이미지: 리퍼러 차단 대응 + 로드 실패 시 브랜드명 이니셜 플레이스홀더
function RefImage({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="flex h-36 w-full items-center justify-center rounded-(--radius-xs) border border-line bg-base/40">
        <span className="text-2xl font-bold text-hint">{name.slice(0, 2)}</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-36 w-full rounded-(--radius-xs) bg-white object-cover"
      loading="lazy"
    />
  );
}

// 운영자가 아는 사례 URL을 직접 레퍼런스로 등록
function ManualRefAdd({ disabled, onAdd }: { disabled: boolean; onAdd: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const fire = () => {
    if (!url.trim()) return;
    onAdd(url.trim());
    setUrl("");
  };
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && fire()}
        placeholder="아는 사례 URL 직접 추가 — 예: https://www.behance.net/gallery/…"
        className="input min-w-60 flex-1"
        disabled={disabled}
        type="url"
      />
      <button onClick={fire} disabled={disabled || !url.trim()} className="btn btn-ghost shrink-0">
        ➕ 직접 추가
      </button>
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
    <div className="relative mt-2">
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
        placeholder="메모 (어떤 점을 참고할지)"
        className="input !py-1.5 pr-20 text-xs"
      />
      {saved && (
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs font-semibold text-inv">
          ✓ 저장됨
        </span>
      )}
    </div>
  );
}
