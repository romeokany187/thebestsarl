"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getCsrfToken, signIn } from "next-auth/react";

const GOOGLE_EMAIL_HINT_STORAGE_KEY = "thebest.google-email-hint";

type SignInClientPageProps = {
  initialMode: FormMode;
  passwordAuthActive: boolean;
  launchAtIso: string;
};

type FormMode = "login" | "setup";

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

function readRememberedEmail() {
  try {
    return normalizeEmailValue(window.sessionStorage.getItem(GOOGLE_EMAIL_HINT_STORAGE_KEY) ?? "");
  } catch {
    return "";
  }
}

function clearRememberedEmail() {
  try {
    window.sessionStorage.removeItem(GOOGLE_EMAIL_HINT_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
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
  const [prefilledSetupEmail, setPrefilledSetupEmail] = useState(false);
  const [mode, setMode] = useState<FormMode>(initialMode);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const launchAtLabel = useMemo(
    () => new Date(launchAtIso).toLocaleString("fr-FR", {
      timeZone: "Africa/Kinshasa",
      dateStyle: "full",
      timeStyle: "short",
    }),
    [launchAtIso],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const setupEmailFromQuery = normalizeEmailValue(params.get("email") ?? "");
    const requiresSetup = params.get("setup") === "required";
    const requestedMode = params.get("mode") === "setup";
    const authError = params.get("error")?.trim() ?? "";

    const rememberedEmail = readRememberedEmail();
    const resolvedEmail = setupEmailFromQuery || rememberedEmail;

    if (requiresSetup && resolvedEmail) {
      setPrefilledSetupEmail(true);
      setSetupEmail(resolvedEmail);
      clearRememberedEmail();
    } else if (!requiresSetup) {
      clearRememberedEmail();
    }

    if (authError) {
      setMode(errorCodeToMode(authError));
      setError(getFriendlySignInError(authError, launchAtLabel));
      setMessage("");
      return;
    }

    if (requiresSetup) {
      setMode("setup");
      setMessage("Première connexion confirmée. Configurez maintenant votre mot de passe pour finaliser l'accès à votre espace.");
      setError("");
      return;
    }

    if (requestedMode) {
      setMode("setup");
    }
  }, []);

  function resetSetupProgress(options?: { keepFeedback?: boolean }) {
    setSetupRequested(false);
    setSetupCode("");
    if (!options?.keepFeedback) {
      setError("");
      setMessage("");
    }
  }

  function clearSetupIdentity() {
    clearRememberedEmail();
    setSetupEmail("");
    setSetupPassword("");
    setSetupPasswordConfirmation("");
    setSetupCode("");
    setPrefilledSetupEmail(false);
  }

  function openLoginMode(options?: { keepFeedback?: boolean }) {
    setMode("login");
    clearSetupIdentity();
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

    try {
      if (hintedEmail) {
        window.sessionStorage.setItem(GOOGLE_EMAIL_HINT_STORAGE_KEY, hintedEmail);
      } else {
        clearRememberedEmail();
      }
    } catch {
      // Ignore storage errors and continue the auth flow.
    }

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
      callbackInput.value = "/post-login";
      form.appendChild(callbackInput);

      document.body.appendChild(form);
      form.submit();
      return;
    } catch {
      setError("Impossible de démarrer la connexion Google. Réessayez dans un seul onglet sur le domaine officiel de l'application.");
    }

    setLoading(false);
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

    const result = await signIn("credentials", {
      email,
      password,
      callbackUrl: "/post-login",
      redirect: false,
    });

    if (!result || result.error) {
      setError("Connexion refusée. Vérifie ton email et ton mot de passe, ou crée d'abord ton mot de passe.");
      setLoading(false);
      return;
    }

    window.location.href = result.url || "/post-login";
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
      clearRememberedEmail();

      const result = await signIn("credentials", {
        email: setupEmail,
        password: setupPassword,
        callbackUrl: "/post-login",
        redirect: false,
      });

      if (!result || result.error) {
        setMessage("Mot de passe créé. Vous pouvez maintenant vous connecter.");
        openLoginMode({ keepFeedback: true });
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
    <main className="h-screen overflow-hidden bg-[#07124c] text-slate-950">
      <section className="relative h-screen overflow-hidden bg-[#07124c]">
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,17,74,0.86),rgba(6,17,74,0.98))]" />
        <div className="absolute -left-24 top-[-6%] h-168 w-168 rounded-full border border-sky-400/30" />
        <div className="absolute -left-10 top-[12%] h-152 w-152 rounded-full border border-sky-400/20" />
        <div className="absolute left-[16%] top-[-10%] h-224 w-224 rounded-full border border-sky-400/15" />

        <div className="relative mx-auto flex h-screen w-full max-w-[1600px] items-center px-5 py-6 text-white sm:px-8 lg:px-10 xl:px-16">
          <div className="grid w-full items-center gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,430px)] lg:gap-10 xl:gap-14">
            <div className="min-w-0 self-center">
              <Link
                href="/"
                className="inline-flex rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-[11px] font-semibold tracking-[0.24em] text-white/80 transition hover:bg-white/10"
              >
                THEBEST SARL WORKSPACE
              </Link>

              <div className="mt-10 max-w-xl lg:mt-12">
                <p className="text-sm font-medium uppercase tracking-[0.22em] text-sky-200/80">
                  Authentification securisee
                </p>
                <h1 className="mt-5 text-5xl font-semibold leading-[1.02] text-white xl:text-6xl">
                  Espace de travail
                  <br />
                  THEBEST SARL
                </h1>
                <p className="mt-6 max-w-lg text-base leading-7 text-white/72">
                  Premiere entree Google, creation du mot de passe, puis validation OTP unique.
                </p>

                <div className="mt-8 grid max-w-2xl gap-3 md:grid-cols-3">
                  {[
                    { step: "01", title: "Premiere entree", text: "Google" },
                    { step: "02", title: "Mot de passe", text: "Creation" },
                    { step: "03", title: "OTP", text: "Validation" },
                  ].map((item) => (
                    <div key={item.step} className="rounded-2xl border border-white/12 bg-white/6 p-4 backdrop-blur-sm">
                      <p className="text-[11px] font-semibold tracking-[0.25em] text-sky-200/70">{item.step}</p>
                      <h2 className="mt-2 text-sm font-semibold text-white">{item.title}</h2>
                      <p className="mt-1 text-xs leading-5 text-white/58">{item.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="w-full self-center rounded-[28px] border border-white/12 bg-white/8 p-5 shadow-[0_30px_80px_rgba(3,9,38,0.45)] backdrop-blur-md sm:p-5 xl:p-6">
              <div className="rounded-2xl border border-red-200/20 bg-red-500/10 px-4 py-3 text-red-50">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 h-2.5 w-2.5 rounded-full bg-red-300" />
                  <div>
                    <p className="text-sm font-semibold">Alerte de securite</p>
                    <p className="mt-1 text-sm leading-5 text-red-50/85">
                      Utilisez le bon compte Google ou votre email professionnel.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6">
                <h2 className="mt-2 text-4xl font-semibold tracking-tight text-white">
                  {mode === "login"
                    ? "Connexion"
                    : setupRequested
                      ? "Validation OTP"
                      : "Configuration du mot de passe"}
                </h2>
                <p className="mt-2 text-sm leading-5 text-white/62">
                  {mode === "login"
                    ? "Email et mot de passe pour les comptes deja actifs."
                    : setupRequested
                      ? "Entrez le code OTP recu par email."
                      : "Premier acces: Google puis creation du mot de passe."}
                </p>
              </div>

              <div className="mt-6 space-y-4">
                {error ? (
                  <div className="rounded-xl border border-red-200/20 bg-red-500/10 px-4 py-3 text-sm text-red-50">
                    {error}
                  </div>
                ) : null}

                {message ? (
                  <div className="rounded-xl border border-emerald-200/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-50">
                    {message}
                  </div>
                ) : null}

                {mode === "login" ? (
                  <>
                    <form onSubmit={handleCredentialsSignIn} className="space-y-4">
                      <div>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.15em] text-white/45">Obligatoire</p>
                        <label className="mb-1.5 block text-sm font-medium text-white/88">Email professionnel</label>
                        <input
                          type="email"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          className="w-full rounded-lg border border-white/15 bg-white/8 px-4 py-3 text-base text-white outline-none transition placeholder:text-white/35 focus:border-sky-300 focus:bg-white/10"
                          placeholder="vous@thebest.com"
                          required
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-sm font-medium text-white/88">Mot de passe</label>
                        <input
                          type="password"
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          className="w-full rounded-lg border border-white/15 bg-white/8 px-4 py-3 text-base text-white outline-none transition placeholder:text-white/35 focus:border-sky-300 focus:bg-white/10"
                          placeholder="Votre mot de passe"
                          required
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={loading || !passwordAuthActive}
                        className="flex w-full items-center justify-center rounded-lg bg-[#1f66d1] px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-[#1857b5] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {loading ? "Connexion..." : "Connexion"}
                      </button>
                    </form>

                    <div className="border-t border-white/10 pt-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-semibold text-white">Premiere connexion</h3>
                          <p className="mt-1 text-sm leading-5 text-white/58">
                            Activez ici un compte sans mot de passe.
                          </p>
                        </div>

                        <div className={`rounded-full px-3 py-1 text-[11px] font-semibold tracking-[0.16em] ${passwordAuthActive ? "bg-emerald-400/15 text-emerald-100" : "bg-amber-400/15 text-amber-100"}`}>
                          {passwordAuthActive ? "ACTIF" : "EN ATTENTE"}
                        </div>
                      </div>

                      <Link
                        href="/auth/signin?mode=setup"
                        className="mt-4 flex w-full items-center justify-center rounded-lg border border-white/15 bg-white/8 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-white/12"
                      >
                        Creer ou configurer le mot de passe
                      </Link>
                    </div>
                  </>
                ) : null}

                {mode === "setup" ? (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-white/70">
                        {setupRequested ? "OTP EMAIL" : "CONFIGURATION"}
                      </div>

                      <Link
                        href="/auth/signin"
                        onClick={() => openLoginMode()}
                        className="text-sm font-semibold text-white/60 transition hover:text-white"
                      >
                        Retour a la connexion
                      </Link>
                    </div>

                    {!setupRequested ? (
                      <>
                        {!setupEmail ? (
                          <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
                            <p className="text-sm font-semibold text-white">Premiere entree Google</p>
                            <button
                              type="button"
                              onClick={() => void startGoogleSignIn()}
                              disabled={loading}
                              className="mt-3 flex w-full items-center justify-center rounded-lg border border-white/15 bg-white/8 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {loading ? "Ouverture de Google..." : "Continuer avec Google"}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm text-white/75">
                            <span>{setupEmail}</span>
                            <button
                              type="button"
                              onClick={() => {
                                clearSetupIdentity();
                                void startGoogleSignIn();
                              }}
                              className="font-semibold text-white transition hover:text-sky-200"
                            >
                              Changer
                            </button>
                          </div>
                        )}

                        {!passwordAuthActive ? (
                          <div className="rounded-xl border border-dashed border-white/15 bg-white/5 px-4 py-3 text-sm text-white/65">
                            L'ouverture de ce parcours est planifiee pour le {launchAtLabel}.
                          </div>
                        ) : null}

                        <form onSubmit={requestSetupCode} className="space-y-4">
                          <div>
                            <label className="mb-1.5 block text-sm font-medium text-white/88">Email</label>
                            <input
                              type="email"
                              value={setupEmail}
                              onChange={(event) => setSetupEmail(event.target.value)}
                              className="w-full rounded-lg border border-white/15 bg-white/8 px-4 py-3 text-base text-white outline-none transition placeholder:text-white/35 focus:border-sky-300 focus:bg-white/10"
                              placeholder="vous@thebest.com"
                              required
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 block text-sm font-medium text-white/88">Nouveau mot de passe</label>
                            <input
                              type="password"
                              value={setupPassword}
                              onChange={(event) => setSetupPassword(event.target.value)}
                              className="w-full rounded-lg border border-white/15 bg-white/8 px-4 py-3 text-base text-white outline-none transition placeholder:text-white/35 focus:border-sky-300 focus:bg-white/10"
                              placeholder="Minimum 8 caracteres avec lettres et chiffres"
                              required
                            />
                          </div>

                          <div>
                            <label className="mb-1.5 block text-sm font-medium text-white/88">Confirmer le mot de passe</label>
                            <input
                              type="password"
                              value={setupPasswordConfirmation}
                              onChange={(event) => setSetupPasswordConfirmation(event.target.value)}
                              className="w-full rounded-lg border border-white/15 bg-white/8 px-4 py-3 text-base text-white outline-none transition placeholder:text-white/35 focus:border-sky-300 focus:bg-white/10"
                              placeholder="Retapez le mot de passe"
                              required
                            />
                          </div>

                          <button
                            type="submit"
                            disabled={loading || !passwordAuthActive}
                            className="flex w-full items-center justify-center rounded-lg bg-[#1f66d1] px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-[#1857b5] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {loading ? "Verification..." : "Continuer et recevoir l'OTP"}
                          </button>
                        </form>
                      </>
                    ) : (
                      <form onSubmit={confirmPasswordSetup} className="space-y-4 rounded-2xl border border-white/10 bg-white/6 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-white">Application d'authentification</p>

                          <button
                            type="button"
                            onClick={() => resetSetupProgress()}
                            className="text-xs font-semibold text-white/55 hover:text-white"
                          >
                            Recommencer
                          </button>
                        </div>

                        <div>
                          <label className="mb-1.5 block text-sm font-medium text-white/88">Code recu par email</label>
                          <input
                            type="text"
                            inputMode="numeric"
                            maxLength={6}
                            value={setupCode}
                            onChange={(event) => setSetupCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                            className="w-full rounded-lg border border-white/15 bg-[#0d194f] px-4 py-3 text-center text-lg tracking-[0.35em] text-white outline-none transition placeholder:text-white/35 focus:border-sky-300"
                            placeholder="000000"
                            required
                          />
                        </div>

                        <div className="rounded-lg border border-white/10 bg-[#0d194f] px-4 py-3 text-sm text-white/70">
                          <p className="font-medium text-white">Email</p>
                          <p className="mt-1 break-all">{setupEmail}</p>
                        </div>

                        <button
                          type="submit"
                          disabled={loading || !passwordAuthActive}
                          className="flex w-full items-center justify-center rounded-lg bg-[#1f66d1] px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-[#1857b5] disabled:cursor-not-allowed disabled:opacity-60"
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

  return "setup";
}