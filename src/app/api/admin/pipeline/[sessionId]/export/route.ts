import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";

export const maxDuration = 120;

type Params = { params: Promise<{ sessionId: string }> };

// 파이프라인 결과 통합 내보내기: 보고서.md + SVG들 + 선택 시안 PNG (ZIP)
export async function GET(_req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { sessionId } = await params;
  const client = db();

  const { data: session } = await client
    .from("iv_sessions")
    .select("respondent_name, iv_questionnaires(title)")
    .eq("id", sessionId)
    .single();
  const { data: brief } = await client
    .from("iv_briefs")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (!session || !brief) return NextResponse.json({ error: "브리프가 없습니다." }, { status: 404 });

  const [{ data: refs }, { data: concepts }] = await Promise.all([
    client.from("iv_references").select("*").eq("brief_id", brief.id).eq("selected", true),
    client.from("iv_concepts").select("*").eq("brief_id", brief.id).order("created_at"),
  ]);
  const conceptIds = (concepts ?? []).map((c) => c.id);
  const [{ data: svgs }, { data: evals }] = await Promise.all([
    conceptIds.length
      ? client.from("iv_svgs").select("*").in("concept_id", conceptIds).order("created_at")
      : Promise.resolve({ data: [] }),
    conceptIds.length
      ? client.from("iv_evaluations").select("*").in("concept_id", conceptIds).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const engineLabel = (e: string) => (e === "openai" ? "GPT" : "Gemini");
  const latestEval = (cid: string) =>
    (evals ?? []).find((e: { concept_id: string }) => e.concept_id === cid);

  // ── 보고서.md ──
  const qTitle = (session.iv_questionnaires as unknown as { title: string } | null)?.title ?? "";
  const md: string[] = [
    `# 브랜드 디자인 파이프라인 결과`,
    ``,
    `- 인터뷰: ${qTitle} — ${session.respondent_name}`,
    ``,
    `## 1. 브리프`,
    ``,
    `**포지셔닝**: ${brief.content?.positioning ?? ""}`,
    ``,
    `**키워드**: ${(brief.content?.keywords ?? []).join(", ")}`,
    ``,
    `**피할 것**: ${(brief.content?.anti ?? []).join(", ")}`,
    ``,
  ];
  for (const d of brief.content?.directions ?? []) {
    md.push(`### 방향: ${d.name}`, ``, d.concept, ``, `무드: ${(d.mood ?? []).join(" · ")}`, ``);
  }
  md.push(`## 2. 선택된 레퍼런스`, ``);
  for (const r of refs ?? []) {
    md.push(`- **${r.brand_name}** — ${r.summary ?? ""}${r.note ? ` _(메모: ${r.note})_` : ""}${r.url ? ` [링크](${r.url})` : ""}`);
  }
  const feedbacks = (brief.round_feedback ?? []) as { round: number; feedback: string }[];
  if (feedbacks.length) {
    md.push(``, `## 회차 피드백`, ``);
    for (const f of feedbacks) md.push(`- ${f.round}회차 → ${f.round + 1}회차: ${f.feedback}`);
  }
  md.push(``, `## 3. 시안과 평가`, ``);

  const ranked = (concepts ?? [])
    .map((c) => ({ c, e: latestEval(c.id) }))
    .sort((a, b) => (b.e?.total ?? -1) - (a.e?.total ?? -1));

  ranked.forEach(({ c, e }, i) => {
    md.push(`### ${i + 1}위 — ${c.direction} (${c.round ?? 1}회차 · ${engineLabel(c.engine)} #${c.version})${c.selected ? " ✅ 선정" : ""}`, ``);
    if (c.rationale) md.push(`**제작 의도**: ${c.rationale}`, ``);
    if (c.palette?.length) md.push(`**팔레트**: ${c.palette.join(", ")}`, ``);
    if (e) {
      md.push(`**AI 평가: ${e.total}/100**`, ``);
      for (const s of e.scores ?? []) md.push(`- ${s.criterion} (${s.weight}): ${s.score}/10 — ${s.reason}`);
      if (e.summary) md.push(``, `> ${e.summary}`);
      md.push(``);
    }
  });
  md.push(`---`, ``, `_AI 평가는 참고용 1차 스크리닝이며, 최종 선정은 대표 합의 기준을 따릅니다._`);

  // ── ZIP 조립 ──
  const zip = new JSZip();
  zip.file("보고서.md", md.join("\n"));

  const svgFolder = zip.folder("svg");
  for (const s of svgs ?? []) {
    const parent = (concepts ?? []).find((c) => c.id === s.concept_id);
    const name = `${(parent?.direction ?? "logo").replace(/[\\/:*?"<>|]/g, "")}-${engineLabel(parent?.engine ?? "")}-v${s.version}.svg`;
    svgFolder?.file(name, s.svg);
  }

  // 선정(selected)된 시안의 PNG 포함
  const pngFolder = zip.folder("png");
  for (const c of (concepts ?? []).filter((x) => x.selected)) {
    for (const [mode, path] of [["light", c.image_light_path], ["dark", c.image_dark_path]] as const) {
      if (!path) continue;
      const { data: file } = await client.storage.from("iv-concepts").download(path);
      if (file) {
        pngFolder?.file(
          `${c.direction.replace(/[\\/:*?"<>|]/g, "")}-${engineLabel(c.engine)}-v${c.version}-${mode}.png`,
          Buffer.from(await file.arrayBuffer())
        );
      }
    }
  }

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="design-pipeline-${sessionId.slice(0, 8)}.zip"`,
    },
  });
}
