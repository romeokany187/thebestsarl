import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/auth";
import { isPasswordAuthActive, passwordAuthLaunchAtIso } from "@/lib/auth-rollout";
import SignInClientPage from "./sign-in-client";

type SignInPageProps = {
  searchParams?: Promise<{
    mode?: string;
  }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const session = await getServerSession(authOptions);
  if (session?.user?.email) {
    redirect("/post-login");
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialMode = resolvedSearchParams?.mode === "setup"
    ? "setup"
    : resolvedSearchParams?.mode === "login"
      ? "login"
      : resolvedSearchParams?.mode === "forgot"
        ? "forgot"
      : "google";

  return (
    <SignInClientPage
      initialMode={initialMode}
      passwordAuthActive={isPasswordAuthActive()}
      launchAtIso={passwordAuthLaunchAtIso()}
    />
  );
}
