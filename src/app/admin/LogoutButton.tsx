"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
      className="link-quiet"
    >
      로그아웃
    </button>
  );
}
