"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Item {
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
              s.done ? "bg-inv/15 font-semibold text-inv" : "border border-line text-fg2/50"
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

  useEffect(() => {
    fetch("/api/admin/pipeline").then(async (r) => {
      if (r.ok) setItems((await r.json()).items);
      else setItems([]);
    });
  }, []);

  return (
    <div className="section-enter space-y-8">
      <div>
        <h1 className="text-3xl text-fg">디자인 파이프라인</h1>
        <p className="mt-2 text-sm text-fg2">
          제출된 인터뷰를 기반으로 브리프 → 레퍼런스 → 시안 → 평가 → SVG를 진행합니다.
        </p>
      </div>

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
                      <span className={st.cls}>{st.text}</span>
                      {i.current_round > 1 && <span className="badge badge-progress">🔄 {i.current_round}회차</span>}
                    </span>
                    <span className="mt-0.5 block text-xs text-fg2">
                      {i.questionnaire_title}
                      {i.submitted_at && ` · ${new Date(i.submitted_at).toLocaleDateString("ko-KR")} 제출`}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <Stepper i={i} />
                    <span className="text-inv">→</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
