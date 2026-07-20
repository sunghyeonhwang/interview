import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sniffUploadImage } from "@/lib/ai";

type Params = { params: Promise<{ token: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const BUCKET = "iv-uploads";

// 세션 조회 (i/[token] 라우트의 findSession과 동일 규약)
async function findSession(token: string) {
  if (!UUID_RE.test(token)) return { error: "invalid" as const };
  const { data: session } = await db().from("iv_sessions").select("*").eq("token", token).single();
  if (!session) return { error: "notfound" as const };
  if (new Date(session.expires_at) < new Date()) return { error: "expired" as const };
  return { session };
}

/**
 * 응답자 이미지 업로드 — image 유형 문항 전용.
 * multipart FormData(file, questionId)를 받아 iv-uploads(비공개)에 저장하고,
 * iv_answers에 value=스토리지 경로로 upsert한다(자동 임시저장과 동일하게 업로드 성공=답변 저장됨).
 * 재업로드는 같은 경로 upsert로 덮어쓴다 — 삭제 라우트는 두지 않는다.
 * (확장자가 바뀌는 재업로드만 이전 파일이 남으므로, 직전 경로가 다르면 정리한다.)
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { token } = await params;
  const found = await findSession(token);
  if ("error" in found) {
    const msg = found.error === "expired" ? "링크가 만료되었습니다." : "유효하지 않은 링크입니다.";
    return NextResponse.json({ error: msg }, { status: found.error === "expired" ? 410 : 404 });
  }
  const { session } = found;
  // 제출 후에는 변경 불가
  if (session.status === "submitted") {
    return NextResponse.json({ error: "이미 제출된 인터뷰입니다." }, { status: 409 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const questionId = form?.get("questionId");
  if (!(file instanceof File) || typeof questionId !== "string") {
    return NextResponse.json({ error: "파일과 문항 정보가 필요합니다." }, { status: 400 });
  }

  const client = db();

  // questionId가 이 세션 질문지의 image 유형 문항인지 검증
  const { data: question } = await client
    .from("iv_questions")
    .select("id, type, iv_sections!inner(questionnaire_id)")
    .eq("id", questionId)
    .eq("iv_sections.questionnaire_id", session.questionnaire_id)
    .maybeSingle();
  if (!question) {
    return NextResponse.json({ error: "이 질문지에 없는 문항입니다." }, { status: 400 });
  }
  if (question.type !== "image") {
    return NextResponse.json({ error: "이미지 업로드 문항이 아닙니다." }, { status: 400 });
  }

  // 크기 검증
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "파일이 너무 큽니다. 5MB 이하로 올려주세요." }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());

  // 매직 바이트 스니핑 — Content-Type은 신뢰하지 않는다. PNG/JPG/WebP만 허용.
  const sniffed = sniffUploadImage(buf);
  if (!sniffed) {
    return NextResponse.json(
      { error: "PNG·JPG·WebP 이미지만 올릴 수 있습니다. SVG 등은 PNG로 내보내 주세요." },
      { status: 400 }
    );
  }

  const path = `${session.id}/${questionId}.${sniffed.ext}`;

  const { error: upErr } = await client.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: sniffed.media_type, upsert: true });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // 이전 답변이 확장자가 다른 경로였다면(png→jpg 등) 고아 파일 정리
  const { data: prev } = await client
    .from("iv_answers")
    .select("value")
    .eq("session_id", session.id)
    .eq("question_id", questionId)
    .maybeSingle();
  const prevPath = typeof prev?.value === "string" ? prev.value : null;
  if (prevPath && prevPath !== path) {
    await client.storage.from(BUCKET).remove([prevPath]);
  }

  // iv_answers에 경로 저장 (기존 답변 upsert 패턴)
  const { error: ansErr } = await client
    .from("iv_answers")
    .upsert(
      { session_id: session.id, question_id: questionId, value: path, updated_at: new Date().toISOString() },
      { onConflict: "session_id,question_id" }
    );
  if (ansErr) return NextResponse.json({ error: ansErr.message }, { status: 500 });

  if (session.status === "pending") {
    await client.from("iv_sessions").update({ status: "in_progress" }).eq("id", session.id);
  }

  // 미리보기용 서명 URL(1시간)
  const { data: signed } = await client.storage.from(BUCKET).createSignedUrl(path, 3600);
  return NextResponse.json({ ok: true, path, url: signed?.signedUrl ?? null });
}
