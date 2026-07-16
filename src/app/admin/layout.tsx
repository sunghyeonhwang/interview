import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdmin } from "@/lib/adminSession";
import Logo from "@/components/Logo";
import ThemeToggle from "@/components/ThemeToggle";
import LogoutButton from "./LogoutButton";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) redirect("/login");
  return (
    <div className="flex min-h-screen flex-col">
      <header className="chrome chrome-top sticky top-0 z-20">
        <div className="mx-auto grid max-w-4xl grid-cols-3 items-center px-4 py-3">
          <Link href="/admin" className="link-quiet justify-self-start text-[13px] font-semibold">
            관리자
          </Link>
          <Link href="/admin" aria-label="대시보드로 이동" className="justify-self-center">
            <Logo height={20} />
          </Link>
          <div className="flex items-center gap-3 justify-self-end">
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:py-10">{children}</main>
    </div>
  );
}
