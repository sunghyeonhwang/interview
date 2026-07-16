import "server-only";
import { createClient } from "@supabase/supabase-js";

// service role 클라이언트 — 서버 전용. iv_ 테이블은 RLS 정책이 없으므로
// 이 클라이언트를 통해서만 접근 가능하다.
export function db() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase 환경 변수가 설정되지 않았습니다.");
  return createClient(url, key, { auth: { persistSession: false } });
}
