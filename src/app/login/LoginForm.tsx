"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";

export default function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (res.ok) {
      router.push("/admin");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "로그인에 실패했습니다.");
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 flex justify-center">
        <Logo height={26} />
      </div>
      <form onSubmit={submit} className="card w-full max-w-sm">
        <h1 className="text-lg font-bold text-fg">인터뷰 관리자</h1>
        <p className="mt-1 text-sm text-fg2/60">관리자 비밀번호를 입력하세요.</p>
        <label htmlFor="pw" className="sr-only">비밀번호</label>
        <input
          id="pw"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          autoFocus
          className="input mt-6"
        />
        {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
        <button type="submit" disabled={loading || !password} className="btn btn-primary mt-5 w-full">
          {loading ? "확인 중…" : "로그인"}
        </button>
        <p className="mt-4 text-center text-xs text-fg2">
          <a href="https://que.griff.co.kr" className="text-inv hover:underline">que.griff.co.kr</a>에 로그인되어 있으면 이 화면 없이 자동 접속됩니다.
        </p>
      </form>
    </main>
  );
}
