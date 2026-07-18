import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 네이티브 애드온(.node)은 웹팩 번들에서 제외하고 런타임 require로 로드
  serverExternalPackages: ["@resvg/resvg-js"],
};

export default nextConfig;
