import { isPasswordAuthActive, passwordAuthLaunchAtIso } from "@/lib/auth-rollout";
import SignInClientPage from "./sign-in-client";

export default function SignInPage() {
  return (
    <SignInClientPage
      passwordAuthActive={isPasswordAuthActive()}
      launchAtIso={passwordAuthLaunchAtIso()}
    />
  );
}
