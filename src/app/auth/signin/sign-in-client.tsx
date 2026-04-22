"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getCsrfToken, signIn } from "next-auth/react";

const DEVICE_TOKEN_STORAGE_KEY = "thebest:auth-device-token";

type SignInClientPageProps = {
  initialMode: FormMode;
  passwordAuthActive: boolean;
  launchAtIso: string;
};

type FormMode = "google" | "login" | "setup";

function validateSetupPassword(password: string, confirmation: string) {
  const normalizedPassword = password.trim();

  if (normalizedPassword.length < 8) {
    return "Le mot de passe doit contenir au moins 8 caractères.";
  }

  if (normalizedPassword.length > 100) {
    return "Le mot de passe est trop long.";
  }

  if (!/[A-Za-z]/.test(normalizedPassword)) {
    return "Le mot de passe doit contenir au moins une lettre.";
  }

  if (!/\d/.test(normalizedPassword)) {
    return "Le mot de passe doit contenir au moins un chiffre.";
  }

  if (normalizedPassword !== confirmation.trim()) {
    return "La confirmation du mot de passe ne correspond pas.";
  }

  return null;
}

function extractApiError(payload: unknown, fallback: string) {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const candidate = payload as {
      error?: string | { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
      message?: string;
      launchAt?: string;
    };

    if (typeof candidate.error === "string") {
      return candidate.launchAt
        ? `${candidate.error} Activation prévue le ${new Date(candidate.launchAt).toLocaleString("fr-FR", { timeZone: "Africa/Kinshasa" })}.`
        : candidate.error;
    }

    const formErrors = candidate.error?.formErrors ?? [];
    if (formErrors.length > 0) {
      return formErrors[0] ?? fallback;
    }

    const fieldErrors = candidate.error?.fieldErrors ?? {};
    for (const messages of Object.values(fieldErrors)) {
      if (messages?.[0]) {
        return messages[0];
      }
    }

    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return candidate.message;
    }
  }

  return fallback;
}

function normalizeEmailValue(value: string) {
  return value.trim().toLowerCase();
}

function getFriendlySignInError(errorCode: string, launchAtLabel: string) {
  if (errorCode === "OAuthSignin") {
    return "La connexion Google n'a pas pu démarrer. Réessayez depuis un seul onglet sur le domaine officiel de l'application.";
  }

  if (errorCode === "OAuthCallback") {
    return "Google a bien répondu, mais le cookie de sécurité de retour n'a pas été validé. Fermez les autres onglets de connexion puis recommencez.";
  }

  if (errorCode === "Callback") {
    return "Le retour de Google a échoué. Réessayez la connexion depuis un seul onglet.";
  }

  if (errorCode === "PasswordLoginRequired") {
    return "Ce compte a déjà un mot de passe. Utilisez maintenant l'email et le mot de passe pour vous connecter.";
  }

  if (errorCode === "AccessDenied") {
    return "L'accès a été refusé pour ce compte.";
  }

  if (errorCode === "DatabaseUnavailable") {
    return "La base de données est temporairement indisponible.";
  }

  if (errorCode === "ActivationPending") {
    return `La création du mot de passe sera activée le ${launchAtLabel}.`;
  }

  return "Une erreur de connexion est survenue. Réessayez dans quelques instants.";
}

export default function SignInClientPage({ initialMode, passwordAuthActive, launchAtIso }: SignInClientPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupEmail, setSetupEmail] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupPasswordConfirmation, setSetupPasswordConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [setupRequested, setSetupRequested] = useState(false);
  const [emailLockedByGoogle, setEmailLockedByGoogle] = useState(false);
  const [mode, setMode] = useState<FormMode>(initialMode);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loginChallengeId, setLoginChallengeId] = useState("");
  const [loginOtpCode, setLoginOtpCode] = useState("");
  const launchAtLabel = useMemo(
    () => new Date(launchAtIso).toLocaleString("fr-FR", {
      timeZone: "Africa/Kinshasa",
      dateStyle: "full",
      timeStyle: "short",
    }),
    [launchAtIso],
  );

  useEffect(() => {
    setMode(initialMode);

    if (initialMode === "setup") {
      setEmail("");
      setPassword("");
      setError("");
    }

    if (initialMode === "login") {
      setSetupPassword("");
      setSetupPasswordConfirmation("");
      setSetupCode("");
      setSetupRequested(false);
      setError("");
    }

    if (initialMode === "google") {
      clearSetupIdentity();
      setEmail("");
      setPassword("");
      setEmailLockedByGoogle(false);
    }
  }, [initialMode]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const setupEmailFromQuery = normalizeEmailValue(params.get("email") ?? "");
    const requiresSetup = params.get("setup") === "required";
    const requestedMode = params.get("mode") === "setup"
      ? "setup"
      : params.get("mode") === "login"
        ? "login"
        : "google";
    const googleDone = params.get("google") === "done";
    const authError = params.get("error")?.trim() ?? "";

    if (authError) {
      setMode(errorCodeToMode(authError));
      setError(getFriendlySignInError(authError, launchAtLabel));
      setMessage("");
      return;
    }

    setMode(requestedMode);

    if (googleDone && setupEmailFromQuery) {
      setEmailLockedByGoogle(true);

      if (requestedMode === "login") {
        setEmail(setupEmailFromQuery);
        setPassword("");
        setSetupEmail("");
        setSetupPassword("");
        setSetupPasswordConfirmation("");
        setSetupCode("");
        setSetupRequested(false);
      }

      if (requestedMode === "setup") {
        setSetupEmail(setupEmailFromQuery);
        setEmail("");
        setPassword("");
      }
    } else {
      setEmailLockedByGoogle(false);
    }

    if (requiresSetup) {
      setMode("setup");
      setMessage("Première connexion confirmée. Configurez maintenant votre mot de passe pour finaliser l'accès à votre espace.");
      setError("");
      return;
    }
  }, [launchAtLabel]);

  function resetSetupProgress(options?: { keepFeedback?: boolean }) {
    setSetupRequested(false);
    setSetupCode("");
    if (!options?.keepFeedback) {
      setError("");
      setMessage("");
    }
  }

  function clearSetupIdentity() {
    setSetupEmail("");
    setSetupPassword("");
    setSetupPasswordConfirmation("");
    setSetupCode("");
    setEmailLockedByGoogle(false);
  }

  function resetLoginChallenge(options?: { keepFeedback?: boolean }) {
    setLoginChallengeId("");
    setLoginOtpCode("");
    if (!options?.keepFeedback) {
      setError("");
      setMessage("");
    }
  }

  function openLoginMode(options?: { keepFeedback?: boolean }) {
    setMode("login");
    resetLoginChallenge({ keepFeedback: options?.keepFeedback });
    resetSetupProgress(options);
  }

  function openSetupMode(options?: { keepFeedback?: boolean }) {
    setMode("setup");
    if (!options?.keepFeedback) {
      setError("");
      setMessage("");
    }
  }

  async function startGoogleSignIn() {
    const hintedEmail = normalizeEmailValue(setupEmail || email);

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const csrfToken = (await getCsrfToken())?.trim() ?? "";

      if (!csrfToken) {
        throw new Error("csrf");
      }

      const actionUrl = new URL("/api/auth/signin/google", window.location.origin);
      actionUrl.searchParams.set("prompt", "select_account");
      if (hintedEmail) {
        actionUrl.searchParams.set("login_hint", hintedEmail);
      }

      const form = document.createElement("form");
      form.method = "POST";
      form.action = actionUrl.toString();
      form.style.display = "none";

      const csrfInput = document.createElement("input");
      csrfInput.type = "hidden";
      csrfInput.name = "csrfToken";
      csrfInput.value = csrfToken;
      form.appendChild(csrfInput);

      const callbackInput = document.createElement("input");
      callbackInput.type = "hidden";
      callbackInput.name = "callbackUrl";
      callbackInput.value = "/auth/signin";
      form.appendChild(callbackInput);

      document.body.appendChild(form);
      form.submit();
      return;
    } catch {
      setError("Impossible de démarrer la connexion Google. Réessayez dans un seul onglet sur le domaine officiel de l'application.");
    }

    setLoading(false);
  }

  function getOrCreateDeviceToken() {
    if (typeof window === "undefined") {
      return "";
    }

    const existing = window.localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY)?.trim() ?? "";
    if (existing.length >= 16) {
      return existing;
    }

    const generated = window.crypto?.randomUUID?.()
      ?? `${Date.now()}-${Math.random().toString(36).slice(2, 18)}-${Math.random().toString(36).slice(2, 18)}`;
    window.localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, generated);
    return generated;
  }

  async function completeCredentialsSignIn(params: { deviceToken: string; challengeId?: string }) {
    const result = await signIn("credentials", {
      email,
      password,
      deviceToken: params.deviceToken,
      challengeId: params.challengeId ?? "",
      callbackUrl: "/post-login",
      redirect: false,
    });

    if (!result || result.error) {
      setError("Connexion refusée. Vérifie tes identifiants ou autorise d'abord ce nouvel appareil avec l'OTP envoyé.");
      setLoading(false);
      return false;
    }

    resetLoginChallenge({ keepFeedback: true });
    window.location.href = result.url || "/post-login";
    return true;
  }

  async function handleCredentialsSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!passwordAuthActive) {
      setError(`La connexion par mot de passe sera activée le ${launchAtLabel}.`);
      setMessage("");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    const deviceToken = getOrCreateDeviceToken();

    if (!loginChallengeId) {
      try {
        const response = await fetch("/api/auth/device-session/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, deviceToken }),
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          setError(extractApiError(payload, "Impossible de vérifier l'appareil."));
          setLoading(false);
          return;
        }

        if (payload?.otpRequired) {
          setLoginChallengeId(String(payload.challengeId ?? ""));
          setMessage(payload?.message ?? "Un code OTP a été envoyé pour autoriser ce nouvel appareil.");
          setLoading(false);
          return;
        }
      } catch {
        setError("Erreur réseau lors de la vérification de l'appareil.");
        setLoading(false);
        return;
      }

      await completeCredentialsSignIn({ deviceToken });
      return;
    }

    try {
      const response = await fetch("/api/auth/device-session/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: loginChallengeId,
          code: loginOtpCode,
          deviceToken,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(extractApiError(payload, "Code OTP invalide."));
        setLoading(false);
        return;
      }
    } catch {
      setError("Erreur réseau lors de la validation du code OTP.");
      setLoading(false);
      return;
    }

    await completeCredentialsSignIn({ deviceToken, challengeId: loginChallengeId });
  }

  async function requestSetupCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!passwordAuthActive) {
      setError(`La création du mot de passe sera ouverte le ${launchAtLabel}.`);
      setMessage("");
      return;
    }

    const passwordValidationError = validateSetupPassword(setupPassword, setupPasswordConfirmation);
    if (passwordValidationError) {
      setError(passwordValidationError);
      setMessage("");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/auth/password-setup/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: setupEmail }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(extractApiError(payload, "Impossible d'envoyer le code de confirmation."));
        setLoading(false);
        return;
      }

      setSetupRequested(true);
      setMessage(payload?.message ?? "Un code a été envoyé à votre adresse email. Saisissez-le maintenant pour activer l'accès à votre espace.");
    } catch {
      setError("Erreur réseau lors de l'envoi du code.");
    }

    setLoading(false);
  }

  async function confirmPasswordSetup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!passwordAuthActive) {
      setError(`La création du mot de passe sera ouverte le ${launchAtLabel}.`);
      setMessage("");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/auth/password-setup/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: setupEmail,
          code: setupCode,
          password: setupPassword,
          passwordConfirmation: setupPasswordConfirmation,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setError(extractApiError(payload, "Impossible de créer le mot de passe."));
        setLoading(false);
        return;
      }

      setMessage(payload?.message ?? "Mot de passe créé.");
      setEmail(setupEmail);
      setPassword(setupPassword);
      const deviceToken = getOrCreateDeviceToken();

      const result = await signIn("credentials", {
        email: setupEmail,
        password: setupPassword,
        deviceToken,
        callbackUrl: "/post-login",
        redirect: false,
      });

      if (!result || result.error) {
        setMessage("Mot de passe créé. Connectez-vous maintenant avec ce meme email.");
        setMode("login");
        setEmailLockedByGoogle(true);
        setLoading(false);
        return;
      }

      window.location.href = result.url || "/post-login";
    } catch {
      setError("Erreur réseau lors de la confirmation du mot de passe.");
    }

    setLoading(false);
  }

  return (
    <main className="h-screen overflow-hidden bg-background text-foreground dark:bg-[#0d111a] dark:text-white">
      <section className="relative h-screen overflow-hidden bg-background dark:bg-[#0d111a]">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(245,247,251,0.96),rgba(237,241,247,0.98))] dark:bg-[linear-gradient(180deg,rgba(13,17,26,0.94),rgba(13,17,26,0.99))]" />
        <div className="absolute -left-24 top-[-6%] h-168 w-168 rounded-full border border-black/10 dark:border-white/10" />
        <div className="absolute -left-10 top-[12%] h-152 w-152 rounded-full border border-black/8 dark:border-white/8" />
        <div className="absolute left-[16%] top-[-10%] h-224 w-224 rounded-full border border-black/6 dark:border-white/7" />

        <div className="relative mx-auto flex h-screen w-full max-w-[1600px] items-center px-5 py-6 text-foreground dark:text-white sm:px-8 lg:px-10 xl:px-16">
          <div className="grid w-full items-center gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,430px)] lg:gap-10 xl:gap-14">
            <div className="min-w-0 self-center">
              <Link
                href="/"
                className="inline-flex rounded-full border border-black/12 bg-white/70 px-4 py-1.5 text-[11px] font-semibold tracking-[0.24em] text-black/70 transition hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10"
              >
                THEBEST SARL WORKSPACE
              </Link>

              <div className="mt-10 max-w-xl lg:mt-12">
                <p className="text-sm font-medium uppercase tracking-[0.22em] text-black/55 dark:text-white/55">
                  Authentification securisee
                </p>
                <h1 className="mt-5 text-5xl font-semibold leading-[1.02] text-black xl:text-6xl dark:text-white">
                  Espace de travail
                  <br />
                  THEBEST SARL
                </h1>
                <p className="mt-6 max-w-lg text-base leading-7 text-black/62 dark:text-white/72">
                  Premiere entree Google, creation du mot de passe, puis validation OTP unique.
                </p>

                <div className="mt-8 grid max-w-2xl gap-3 md:grid-cols-3">
                  {[
                    { step: "01", title: "Premiere entree", text: "Google" },
                    { step: "02", title: "Mot de passe", text: "Creation" },
                    { step: "03", title: "OTP", text: "Validation" },
                  ].map((item) => (
                    <div key={item.step} className="rounded-2xl border border-black/10 bg-white/70 p-4 backdrop-blur-sm dark:border-white/12 dark:bg-white/6">
                      <p className="text-[11px] font-semibold tracking-[0.25em] text-black/45 dark:text-white/45">{item.step}</p>
                      <h2 className="mt-2 text-sm font-semibold text-black dark:text-white">{item.title}</h2>
                      <p className="mt-1 text-xs leading-5 text-black/52 dark:text-white/58">{item.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="w-full self-center rounded-[28px] border border-black/10 bg-white/78 p-5 shadow-[0_30px_80px_rgba(24,28,37,0.12)] backdrop-blur-md dark:border-white/12 dark:bg-white/8 dark:shadow-[0_30px_80px_rgba(3,9,38,0.45)] sm:p-5 xl:p-6">
              <div className="rounded-2xl border border-red-500/15 bg-red-500/8 px-4 py-3 text-red-700 dark:border-red-200/20 dark:bg-red-500/10 dark:text-red-50">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 h-2.5 w-2.5 rounded-full bg-red-500 dark:bg-red-300" />
                  <div>
                    <p className="text-sm font-semibold">Alerte de securite</p>
                    <p className="mt-1 text-sm leading-5 text-red-700/80 dark:text-red-50/85">
                      Utilisez le bon compte Google ou votre email professionnel.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <h2 className="mt-2 text-4xl font-semibold tracking-tight text-black dark:text-white">
                  {mode === "google"
                    ? "Connectez-vous avec Google"
                    : mode === "login"
                    ? "Connexion"
                    : setupRequested
                      ? "Validation OTP"
                      : "Configuration du mot de passe"}
                </h2>
                <p className="mt-2 text-sm leading-5 text-black/58 dark:text-white/62">
                  {mode === "google"
                    ? "Commencez toujours par Google. Le systeme recupere ensuite votre email et vous envoie vers la bonne etape."
                    : mode === "login"
                    ? "Email et mot de passe pour les comptes deja actifs."
                    : setupRequested
                      ? "Entrez le code OTP recu par email."
                      : "Premier acces: Google puis creation du mot de passe."}
                </p>
              </div>

              <div className="mt-6 space-y-4">
                {error ? (
                  <div className="rounded-xl border border-red-500/15 bg-red-500/8 px-4 py-3 text-sm text-red-700 dark:border-red-200/20 dark:bg-red-500/10 dark:text-red-50">
                    {error}
                  </div>
                ) : null}

                {message ? (
                  <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/8 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-200/20 dark:bg-emerald-500/10 dark:text-emerald-50">
                    {message}
                  </div>
                ) : null}

                {mode === "google" ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-black/10 bg-white/72 p-4 dark:border-white/10 dark:bg-white/6">
                      <p className="text-sm font-semibold text-black dark:text-white">Authentification initiale</p>
                      <p className="mt-2 text-sm leading-5 text-black/56 dark:text-white/58">
                        Continuez avec le bon compte Google. L'email sera ensuite place automatiquement dans le formulaire adapte.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => void startGoogleSignIn()}
                      disabled={loading}
                      className="flex w-full items-center justify-center rounded-lg bg-black px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-white/85"
                    >
                      {loading ? "Ouverture de Google..." : "Continuer avec Google"}
                    </button>
                  </div>
                ) : null}

                {mode === "login" ? (
                  <>
                    {email ? (
                      <>
                        <form onSubmit={handleCredentialsSignIn} className="space-y-4">
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.15em] text-black/45 dark:text-white/45">Obligatoire</p>
                            <label className="mb-1.5 block text-sm font-medium text-black/88 dark:text-white/88">Email professionnel</label>
                            <input
                              type="email"
                              value={email}
                              onChange={(event) => setEmail(event.target.value)}
                              autoComplete="off"
                              readOnly={emailLockedByGoogle}
                              className="w-full rounded-lg border border-black/12 bg-white px-4 py-3 text-base text-black outline-none transition placeholder:text-black/35 focus:border-black/30 dark:border-white/15 dark:bg-white/8 dark:text-white dark:placeholder:text-white/35 dark:focus:border-white/30 dark:focus:bg-white/10"
                              placeholder="vous@thebest.com"
                              required
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 block text-sm font-medium text-black/88 dark:text-white/88">Mot de passe</label>
                            <input
                              type="password"
                              value={password}
                              onChange={(event) => setPassword(event.target.value)}
                              autoComplete="off"
                              className="w-full rounded-lg border border-black/12 bg-white px-4 py-3 text-base text-black outline-none transition placeholder:text-black/35 focus:border-black/30 dark:border-white/15 dark:bg-white/8 dark:text-white dark:placeholder:text-white/35 dark:focus:border-white/30 dark:focus:bg-white/10"
                              placeholder="Votre mot de passe"
                              required
                            />
                          </div>

                          {loginChallengeId ? (
                            <div>
                              <label className="mb-1.5 block text-sm font-medium text-black/88 dark:text-white/88">Code OTP nouvel appareil</label>
                              <input
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                value={loginOtpCode}
                                onChange={(event) => setLoginOtpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                                className="w-full rounded-lg border border-black/12 bg-white px-4 py-3 text-center text-lg tracking-[0.35em] text-black outline-none transition placeholder:text-black/35 focus:border-black/30 dark:border-white/15 dark:bg-white/8 dark:text-white dark:placeholder:text-white/35 dark:focus:border-white/30 dark:focus:bg-white/10"
                                placeholder="000000"
                                required
                              />
                              <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                                Cette connexion remplace immédiatement la session active sur l'autre appareil.
                              </p>
                            </div>
                          ) : null}

                          <button
                            type="submit"
                            disabled={loading || !passwordAuthActive || (Boolean(loginChallengeId) && loginOtpCode.length !== 6)}
                            className="flex w-full items-center justify-center rounded-lg bg-black px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-white/85"
                          >
                            {loading ? "Connexion..." : loginChallengeId ? "Verifier l'OTP et se connecter" : "Connexion"}
                          </button>
                        </form>

                        <div className="border-t border-black/10 pt-4 text-sm text-black/62 dark:border-white/10 dark:text-white/62">
                          <Link
                            href="/auth/signin"
                            onClick={() => {
                              setEmail("");
                              setPassword("");
                              setEmailLockedByGoogle(false);
                              resetLoginChallenge({ keepFeedback: true });
                            }}
                            className="font-semibold text-black transition hover:text-black/70 dark:text-white dark:hover:text-white/75"
                          >
                            Changer de compte Google
                          </Link>
                        </div>
                      </>
                    ) : (
                      <Link
                        href="/auth/signin"
                        className="flex w-full items-center justify-center rounded-lg bg-black px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-black/85 dark:bg-white dark:text-black dark:hover:bg-white/85"
                      >
                        Continuer avec Google
                      </Link>
                    )}
                  </>
                ) : null}

                {mode === "setup" ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div className="rounded-full bg-black/6 px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-black/60 dark:bg-white/10 dark:text-white/70">
                        {setupRequested ? "OTP EMAIL" : "CONFIGURATION"}
                      </div>

                      <Link
                        href="/auth/signin"
                        onClick={() => {
                          clearSetupIdentity();
                          setMode("google");
                        }}
                        className="text-sm font-semibold text-black/60 transition hover:text-black dark:text-white/60 dark:hover:text-white"
                      >
                        Changer de compte Google
                      </Link>
                    </div>

                    {!setupRequested ? (
                      <>
                        {setupEmail ? (
                          <div className="flex items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white/72 px-4 py-3 text-sm text-black/75 dark:border-white/10 dark:bg-white/6 dark:text-white/75">
                            <span>{setupEmail}</span>
                            <button
                              type="button"
                              onClick={() => {
                                clearSetupIdentity();
                                setMode("google");
                              }}
                              className="font-semibold text-black transition hover:text-black/70 dark:text-white dark:hover:text-white/75"
                            >
                              Changer
                            </button>
                          </div>
                        ) : null}

                        {!passwordAuthActive ? (
                          <div className="rounded-xl border border-dashed border-black/12 bg-white/65 px-4 py-3 text-sm text-black/65 dark:border-white/15 dark:bg-white/5 dark:text-white/65">
                            L'ouverture de ce parcours est planifiee pour le {launchAtLabel}.
                          </div>
                        ) : null}

                        {setupEmail ? (
                          <form onSubmit={requestSetupCode} className="space-y-4">
                          <div>
                            <label className="mb-1.5 block text-sm font-medium text-black/88 dark:text-white/88">Email</label>
                            <input
                              type="email"
                              value={setupEmail}
                              onChange={(event) => setSetupEmail(event.target.value)}
                              autoComplete="off"
                              readOnly={emailLockedByGoogle}
                              className="w-full rounded-lg border border-black/12 bg-white px-4 py-3 text-base text-black outline-none transition placeholder:text-black/35 focus:border-black/30 dark:border-white/15 dark:bg-white/8 dark:text-white dark:placeholder:text-white/35 dark:focus:border-white/30 dark:focus:bg-white/10"
                              placeholder="vous@thebest.com"
                              required
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 block text-sm font-medium text-black/88 dark:text-white/88">Nouveau mot de passe</label>
                            <input
                              type="password"
                              value={setupPassword}
                              onChange={(event) => setSetupPassword(event.target.value)}
                              autoComplete="new-password"
                              className="w-full rounded-lg border border-black/12 bg-white px-4 py-3 text-base text-black outline-none transition placeholder:text-black/35 focus:border-black/30 dark:border-white/15 dark:bg-white/8 dark:text-white dark:placeholder:text-white/35 dark:focus:border-white/30 dark:focus:bg-white/10"
                              placeholder="Minimum 8 caracteres avec lettres et chiffres"
                              required
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 block text-sm font-medium text-black/88 dark:text-white/88">Confirmer le mot de passe</label>
                            <input
                              type="password"
                              value={setupPasswordConfirmation}
                              onChange={(event) => setSetupPasswordConfirmation(event.target.value)}
                              autoComplete="new-password"
                              className="w-full rounded-lg border border-black/12 bg-white px-4 py-3 text-base text-black outline-none transition placeholder:text-black/35 focus:border-black/30 dark:border-white/15 dark:bg-white/8 dark:text-white dark:placeholder:text-white/35 dark:focus:border-white/30 dark:focus:bg-white/10"
                              placeholder="Retapez le mot de passe"
                              required
                            />
                          </div>

                          <button
                            type="submit"
                            disabled={loading || !passwordAuthActive}
                            className="flex w-full items-center justify-center rounded-lg bg-black px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-white/85"
                          >
                            {loading ? "Verification..." : "Continuer et recevoir l'OTP"}
                          </button>
                          </form>
                        ) : (
                          <Link
                            href="/auth/signin"
                            className="flex w-full items-center justify-center rounded-lg bg-black px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-black/85 dark:bg-white dark:text-black dark:hover:bg-white/85"
                          >
                            Continuer avec Google
                          </Link>
                        )}
                      </>
                    ) : (
                      <form onSubmit={confirmPasswordSetup} className="space-y-4 rounded-2xl border border-black/10 bg-white/72 p-4 dark:border-white/10 dark:bg-white/6">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-black dark:text-white">Application d'authentification</p>

                          <button
                            type="button"
                            onClick={() => resetSetupProgress()}
                            className="text-xs font-semibold text-black/55 hover:text-black dark:text-white/55 dark:hover:text-white"
                          >
                            Recommencer
                          </button>
                        </div>

                        <div>
                          <label className="mb-1.5 block text-sm font-medium text-black/88 dark:text-white/88">Code recu par email</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={setupCode}
                            onChange={(event) => setSetupCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                            className="w-full rounded-lg border border-black/12 bg-white px-4 py-3 text-center text-lg tracking-[0.35em] text-black outline-none transition placeholder:text-black/35 focus:border-black/30 dark:border-white/15 dark:bg-[#161b26] dark:text-white dark:placeholder:text-white/35 dark:focus:border-white/30"
                            placeholder="000000"
                            required
                          />
                        </div>

                        <div className="rounded-lg border border-black/10 bg-white px-4 py-3 text-sm text-black/70 dark:border-white/10 dark:bg-[#161b26] dark:text-white/70">
                          <p className="font-medium text-black dark:text-white">Email</p>
                          <p className="mt-1 break-all">{setupEmail}</p>
                        </div>

                        <button
                          type="submit"
                          disabled={loading || !passwordAuthActive}
                          className="flex w-full items-center justify-center rounded-lg bg-black px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-white/85"
                        >
                          {loading ? "Validation..." : "Verifier et se connecter"}
                        </button>
                      </form>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          </div>

        </div>
      </section>
    </main>
  );
}

function errorCodeToMode(errorCode: string): FormMode {
  if (errorCode === "PasswordLoginRequired") {
    return "login";
  }

  return "google";
}