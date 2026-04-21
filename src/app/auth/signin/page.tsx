import { isPasswordAuthActive, passwordAuthLaunchAtIso } from "@/lib/auth-rollout";
import SignInClientPage from "./sign-in-client";

type SignInPageProps = {
  searchParams?: Promise<{
    mode?: string;
  }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const initialMode = resolvedSearchParams?.mode === "setup"
    ? "setup"
    : resolvedSearchParams?.mode === "login"
      ? "login"
      : "google";

  return (
    <SignInClientPage
      initialMode={initialMode}
      passwordAuthActive={isPasswordAuthActive()}
      launchAtIso={passwordAuthLaunchAtIso()}
    />
  );
}
