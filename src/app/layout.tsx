import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GRIFF 인터뷰",
  description: "브랜딩 프로젝트 인터뷰 도구",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        {/* 첫 페인트 전에 저장된 테마 복원 (FOUC 방지) */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("theme");if(t==="light")document.documentElement.dataset.theme="light"}catch(e){}`,
          }}
        />
        {/* React 19가 <head>로 호이스팅 — Tailwind @import 제거 문제 회피 */}
        <link
          rel="stylesheet"
          href="https://fastly.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
          precedence="default"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700;900&display=swap"
          precedence="default"
        />
        {children}
      </body>
    </html>
  );
}
