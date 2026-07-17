import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/adminSession";
import { ownerFilter } from "@/lib/pipeline";

type Params = { params: Promise<{ sessionId: string }> };

// 다음 회차 시작: 피드백을 기록하고 current_round를 올린다
export async function POST(req: NextRequest, { params }: Params) {
  if (!(await isAdmin())) return NextResponse.json({ error: "인증 필요" }, { status: 401 });
  const { sessionId } = await params;
  const { feedback } = (await req.json().catch(() => ({}))) as { feedback?: string };
  if (!feedback?.trim()) {
    return NextResponse.json({ error: "다음 회차의 방향 피드백을 입력하세요." }, { status: 400 });
  }
  const client = db();

  const { data: brief } = await client
    .from("iv_briefs")
    .select("id, current_round, round_feedback")
    .or(ownerFilter(sessionId))
    .maybeSingle();
  if (!brief) return NextResponse.json({ error: "브리프가 없습니다." }, { status: 400 });

  // 이번 회차에 선택된 시안이 있어야 다음 회차의 발전 기반이 생긴다
  const { count } = await client
    .from("iv_concepts")
    .select("id", { count: "exact", head: true })
    .eq("brief_id", brief.id)
    .eq("round", brief.current_round)
    .eq("selected", true);
  if (!count) {
    return NextResponse.json(
      { error: `이번 회차(${brief.current_round}회차)에서 발전시킬 시안을 먼저 선택하세요.` },
      { status: 400 }
    );
  }

  const nextRound = brief.current_round + 1;
  const { data, error } = await client
    .from("iv_briefs")
    .update({
      current_round: nextRound,
      round_feedback: [
        ...(brief.round_feedback ?? []),
        { round: brief.current_round, feedback: feedback.trim(), created_at: new Date().toISOString() },
      ],
      updated_at: new Date().toISOString(),
    })
    .eq("id", brief.id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ brief: data });
}
