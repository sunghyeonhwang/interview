import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/adminSession";
import LoginForm from "./LoginForm";

// Que(que.griff.co.kr) 세션이 있으면 로그인 화면 없이 바로 관리자로
export default async function LoginPage() {
  if (await isAdmin()) redirect("/admin");
  return <LoginForm />;
}
