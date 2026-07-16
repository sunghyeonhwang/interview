"use client";

import { useEffect, useState } from "react";

// 다크(기본) ↔ 라이트 토글. 선택은 localStorage에 저장되고
// layout.tsx의 인라인 스크립트가 첫 페인트 전에 복원한다.
export default function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    setTheme(current);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {}
  }

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "라이트 테마로 전환" : "다크 테마로 전환"}
      title={theme === "dark" ? "라이트 테마" : "다크 테마"}
      className={`flex h-8 w-8 items-center justify-center rounded-full border border-line text-sm transition-colors duration-200 hover:border-line-strong ${className}`}
    >
      <span aria-hidden>{theme === "dark" ? "☀️" : "🌙"}</span>
    </button>
  );
}
