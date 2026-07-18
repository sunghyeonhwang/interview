import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import { ownerFilter } from "@/lib/pipeline";

export const maxDuration = 60;

type Params = { params: Promise<{ sessionId: string }> };

// 시안 정리 / 파이프라인 재시작
// mode "prune":   ⭐·선택 시안만 남기고 나머지 삭제 (브리프·레퍼런스·회차는 그대로)
// mode "restart": prune + 미선택 레퍼런스 삭제 + 회차 리셋 + 기각 사유 기록
//                 (기각 사유는 다음 브리프 재생성 시 "반드시 피할 것"으로 반영됨)
export async function POST(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { sessionId } = await params;
  const { mode, feedback } = (await req.json().catch(() => ({}))) as {
    mode?: "prune" | "restart";
    feedback?: string;
  };
  if (mode !== "prune" && mode !== "restart") {
    return NextResponse.json({ error: "mode는 prune 또는 restart여야 합니다." }, { status: 400 });
  }
  if (mode === "restart" && !feedback?.trim()) {
    return NextResponse.json({ error: "무엇이 마음에 들지 않았는지 입력하세요 — 다음 브리프에 반영됩니다." }, { status: 400 });
  }
  const client = db();

  const { data: brief } = await client
    .from("iv_briefs")
    .select("id, reset_notes")
    .or(ownerFilter(sessionId))
    .maybeSingle();
  if (!brief) return NextResponse.json({ error: "브리프가 없습니다." }, { status: 400 });

  // ⭐(별표) 또는 선택된 시안은 보존, 나머지는 삭제
  const { data: concepts } = await client
    .from("iv_concepts")
    .select("id, starred, selected, image_light_path, image_dark_path")
    .eq("brief_id", brief.id);
  const drop = (concepts ?? []).filter((c) => !c.starred && !c.selected);
  const kept = (concepts ?? []).length - drop.length;

  if (drop.length) {
    const dropIds = drop.map((c) => c.id);
    const { data: mockups } = await client.from("iv_mockups").select("image_path").in("concept_id", dropIds);
    const removals = [
      ...drop.flatMap((c) => [c.image_light_path, c.image_dark_path]),
      ...(mockups ?? []).map((m) => m.image_path),
    ].filter(Boolean);
    if (removals.length) await client.storage.from("iv-concepts").remove(removals);
    const { error } = await client.from("iv_concepts").delete().in("id", dropIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let refsRemoved = 0;
  if (mode === "restart") {
    // 선택하지 않은 레퍼런스 정리 (스냅샷 이미지 포함)
    const { data: removedRefs, error: refErr } = await client
      .from("iv_references")
      .delete()
      .eq("brief_id", brief.id)
      .eq("selected", false)
      .select("id, image_path");
    if (refErr) return NextResponse.json({ error: refErr.message }, { status: 500 });
    refsRemoved = removedRefs?.length ?? 0;
    const refSnaps = (removedRefs ?? []).map((r) => r.image_path).filter(Boolean);
    if (refSnaps.length) await client.storage.from("iv-concepts").remove(refSnaps);

    // 회차 리셋 + 기각 사유 누적 (브리프 내용은 이후 재생성 시 사유를 반영해 교체됨)
    const { error } = await client
      .from("iv_briefs")
      .update({
        current_round: 1,
        round_feedback: [],
        reset_notes: [
          ...((brief.reset_notes ?? []) as unknown[]),
          { feedback: feedback!.trim(), created_at: new Date().toISOString() },
        ],
        updated_at: new Date().toISOString(),
      })
      .eq("id", brief.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ kept, removed: drop.length, refs_removed: refsRemoved });
}
