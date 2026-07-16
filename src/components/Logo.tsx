import Image from "next/image";

// que.griff.co.kr/logo-full.svg — 원본이 검정이므로 다크 배경에서 invert
export default function Logo({ height = 22, className = "" }: { height?: number; className?: string }) {
  return (
    <Image
      src="/logo-full.svg"
      alt="GRIFF"
      width={Math.round((203 / 42) * height)}
      height={height}
      priority
      className={`logo-invert ${className}`}
    />
  );
}
