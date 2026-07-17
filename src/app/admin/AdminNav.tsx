"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const MENUS = [
  { href: "/admin", label: "인터뷰", active: (p: string) => p === "/admin" || p.startsWith("/admin/q") || p.startsWith("/admin/s") },
  { href: "/admin/design", label: "디자인", active: (p: string) => p.startsWith("/admin/design") || p.startsWith("/admin/p") },
];

export default function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {MENUS.map((m) => {
        const on = m.active(pathname);
        return (
          <Link
            key={m.href}
            href={m.href}
            className={`rounded-full px-3 py-1 text-[13px] font-semibold transition-colors duration-200 ${
              on ? "bg-key text-white" : "text-fg2 hover:text-fg"
            }`}
          >
            {m.label}
          </Link>
        );
      })}
    </nav>
  );
}
