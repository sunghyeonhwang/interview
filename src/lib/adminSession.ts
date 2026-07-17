import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { decode } from "@auth/core/jwt";
import { cookies } from "next/headers";

const COOKIE = "iv_admin";
const MAX_AGE = 60 * 60 * 24 * 7; // 7일

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET이 설정되지 않았습니다.");
  return new TextEncoder().encode(s);
}

export async function createAdminSession() {
  const token = await new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function destroyAdminSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();

  // 1) 자체 세션 (비밀번호 로그인)
  const token = store.get(COOKIE)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret());
      if (payload.role === "admin") return true;
    } catch {
      /* fall through */
    }
  }

  // 2) Que(que.griff.co.kr) next-auth 세션 공유 — .griff.co.kr 도메인 쿠키.
  //    같은 AUTH_SECRET으로 복호화되는 유효한 Que 세션이면 전 직원 자동 접속 허용.
  const queSecret = process.env.QUE_AUTH_SECRET;
  if (!queSecret) return false;
  // salt는 발급 당시의 쿠키 이름과 일치해야 한다 (prod: __Secure- 접두사)
  const candidates = ["__Secure-authjs.session-token", "authjs.session-token"];
  for (const name of candidates) {
    const raw = store.get(name)?.value;
    if (!raw) continue;
    try {
      const jwt = await decode({ token: raw, secret: queSecret, salt: name });
      if (typeof jwt?.email === "string" && jwt.email) return true;
    } catch {
      /* 다음 후보 시도 */
    }
  }
  return false;
}
