import { redirect } from "next/navigation";
import { userCount } from "@/lib/auth";
import AuthForm from "@/components/AuthForm";
import { DEMO_MODE } from "@/lib/demo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up" };

export default async function Setup() {
  if (DEMO_MODE) redirect("/");
  if ((await userCount()) > 0) redirect("/login");
  return <AuthForm mode="setup" />;
}
