"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Item {
  type: "interview" | "project";
  session_id: string;
  respondent_name: string;
  questionnaire_title: string;
  submitted_at: string | null;
  has_brief: boolean;
  current_round: number;
  references: number;
  concepts: number;
  evaluations: number;
  svgs: number;
}

function stage(i: Item): { text: string; cls: string } {
  if (i.svgs > 0) return { text: "SVG 완료", cls: "badge badge-done" };
  if (i.concepts > 0) return { text: "시안 진행", cls: "badge badge-progress" };
  if (i.references > 0) return { text: "레퍼런스 수집", cls: "badge badge-progress" };
  if (i.has_brief) return { text: "브리프 생성됨", cls: "badge badge-progress" };
  return { text: "시작 전", cls: "badge badge-pending" };
}

// 애셋 프로젝트 생성 — 인터뷰 없이 기존 브랜드(키컬러·로고)에서 파이프라인 시작
function NewProjectForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [brand, setBrand] = useState("");
  const [goal, setGoal] = useState("");
  const [colors, setColors] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!title.trim() || !brand.trim()) {
      setError("프로젝트명과 브랜드명을 입력하세요.");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("title", title.trim());
    form.set("brand_name", brand.trim());
    form.set("goal", goal.trim());
    form.set("key_colors", colors.trim());
    for (const f of files ?? []) form.append("assets", f);
    try {
      const res = await fetch("/api/admin/projects", { method: "POST", body: form });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "프로젝트 생성 실패");
      } else {
        onCreated();
      }
    } catch {
      setError("프로젝트 생성 중 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="text-xl text-fg">새 애셋 프로젝트</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-fg2">
          이미 확립된 브랜드의 <strong className="text-fg">키컬러·로고 애셋 베리에이션</strong>이 필요할 때 사용합니다.
          업로드한 원본 로고는 모든 시안 생성에서 AI가 직접 보며 아이덴티티를 유지합니다.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="프로젝트명 — 예: JB은행 경진대회" className="input" />
        <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="브랜드명 — 예: JB은행" className="input" />
        <input value={colors} onChange={(e) => setColors(e.target.value)} placeholder="키컬러 (콤마 구분) — 예: #0067AC, #E60012" className="input" />
        <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="목표 — 예: 경진대회용 로고 애셋 베리에이션" className="input" />
      </div>
      <div>
        <label className="text-xs text-fg2">원본 로고 애셋 (PNG/JPG/WebP, 여러 개 가능 — 첫 2장이 생성에 사용됩니다)</label>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={(e) => setFiles(e.target.files)}
          className="input mt-1 !py-1.5 text-xs"
        />
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button onClick={submit} disabled={busy} className="btn btn-primary">
        {busy ? "⏳ 생성 중…" : "프로젝트 만들기"}
      </button>
    </div>
  );
}

// 파이프라인 단계별 진행 스테퍼
function Stepper({ i }: { i: Item }) {
  const steps = [
    { label: "브리프", done: i.has_brief, count: 0 },
    { label: "레퍼런스", done: i.references > 0, count: i.references },
    { label: "시안", done: i.concepts > 0, count: i.concepts },
    { label: "평가", done: i.evaluations > 0, count: i.evaluations },
    { label: "SVG", done: i.svgs > 0, count: i.svgs },
  ];
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs">
      {steps.map((s, idx) => (
        <span key={s.label} className="flex items-center gap-1">
          {idx > 0 && <span className="text-fg2/30">→</span>}
          <span
            className={`rounded-full px-2 py-0.5 whitespace-nowrap ${
              s.done ? "bg-inv/15 font-semibold text-inv" : "border border-line text-hint"
            }`}
          >
            {s.done ? "✓ " : ""}{s.label}{s.count > 0 ? ` ${s.count}` : ""}
          </span>
        </span>
      ))}
    </span>
  );
}

export default function DesignList() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [cleanMsg, setCleanMsg] = useState("");

  const load = () =>
    fetch("/api/admin/pipeline").then(async (r) => {
      if (r.ok) setItems((await r.json()).items);
      else setItems([]);
    });

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="section-enter space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl text-fg">디자인 파이프라인</h1>
          <p className="mt-2 text-sm text-fg2">
            제출된 인터뷰 또는 기존 브랜드 애셋을 기반으로 브리프 → 레퍼런스 → 시안 → 평가 → SVG를 진행합니다.
          </p>
        </div>
        <button onClick={() => setShowNew((v) => !v)} className="btn btn-primary shrink-0">
          {showNew ? "✕ 닫기" : "＋ 애셋 프로젝트"}
        </button>
      </div>

      {showNew && <NewProjectForm onCreated={() => { setShowNew(false); load(); }} />}

      {items === null ? (
        <p className="text-sm text-fg2">불러오는 중…</p>
      ) : items.length === 0 ? (
        <div className="card text-center">
          <p className="text-sm text-fg2">
            제출 완료된 인터뷰가 없습니다. 파이프라인은 응답자가 인터뷰를 제출하면 시작할 수 있습니다.
          </p>
          <Link href="/admin" className="btn btn-ghost mt-4 inline-flex">인터뷰 관리로 →</Link>
        </div>
      ) : (
        <ul className="card divide-y divide-line !p-0">
          {items.map((i) => {
            const st = stage(i);
            return (
              <li key={i.session_id} className="group row-hover">
                <Link href={`/admin/p/${i.session_id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold text-fg group-hover:text-inv">
                        {i.respondent_name}
                      </span>
                      {i.type === "project" && <span className="badge badge-pending">🎨 애셋</span>}
                      <span className={st.cls}>{st.text}</span>
                      {i.current_round > 1 && <span className="badge badge-progress">🔄 {i.current_round}회차</span>}
                    </span>
                    <span className="mt-0.5 block text-xs text-fg2">
                      {i.questionnaire_title}
                      {i.submitted_at && ` · ${new Date(i.submitted_at).toLocaleDateString("ko-KR")} ${i.type === "project" ? "생성" : "제출"}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <Stepper i={i} />
                    {i.type === "project" && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          if (confirm(`"${i.questionnaire_title}" 프로젝트를 삭제할까요? 생성된 시안·SVG·목업이 함께 삭제되며 복구할 수 없습니다.`)) {
                            fetch(`/api/admin/projects/${i.session_id}`, { method: "DELETE" }).then(load);
                          }
                        }}
                        className="link-quiet text-xs !text-danger/70 hover:!text-danger"
                      >
                        삭제
                      </button>
                    )}
                    <span className="text-inv">→</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={async () => {
            if (!confirm("어디에서도 참조되지 않는 스토리지 파일을 정리할까요? (최근 30분 내 생성 파일은 보호됩니다)")) return;
            setCleanMsg("⏳ 정리 중…");
            try {
              const r = await fetch("/api/admin/maintenance", { method: "POST" });
              const d = await r.json().catch(() => ({}));
              setCleanMsg(r.ok ? `✓ ${d.removed}개 파일 정리 (${d.freed_mb}MB 확보, 전체 ${d.scanned}개 스캔)` : `⚠️ ${d.error ?? "정리 실패"}`);
            } catch {
              setCleanMsg("⚠️ 정리 중 오류가 발생했습니다.");
            }
          }}
          className="link-quiet text-xs"
        >
          🧹 스토리지 정리
        </button>
        {cleanMsg && <span className="text-xs text-fg2">{cleanMsg}</span>}
      </div>
    </div>
  );
}
