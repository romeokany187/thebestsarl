"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getCsrfToken, signIn } from "next-auth/react";

const GOOGLE_EMAIL_HINT_STORAGE_KEY = "thebest.google-email-hint";

type SignInClientPageProps = {
  passwordAuthActive: boolean;
  launchAtIso: string;
};

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

export default function SignInClientPage({ passwordAuthActive, launchAtIso }: SignInClientPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupEmail, setSetupEmail] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupPasswordConfirmation, setSetupPasswordConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [setupRequested, setSetupRequested] = useState(false);
  const [prefilledSetupEmail, setPrefilledSetupEmail] = useState(false);
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
    const authError = params.get("error")?.trim() ?? "";

    let rememberedEmail = "";
    try {
      rememberedEmail = normalizeEmailValue(window.sessionStorage.getItem(GOOGLE_EMAIL_HINT_STORAGE_KEY) ?? "");
    } catch {
      rememberedEmail = "";
    }

    const resolvedEmail = setupEmailFromQuery || rememberedEmail;

    if (resolvedEmail) {
      setPrefilledSetupEmail(true);
      setSetupEmail(resolvedEmail);
      setEmail(resolvedEmail);
    }

    if (authError) {
      setError(getFriendlySignInError(authError, launchAtLabel));
      setMessage("");
      return;
    }

    if (requiresSetup) {
      setMessage("Première connexion confirmée. Configurez maintenant votre mot de passe pour finaliser l'accès à votre espace.");
      setError("");
    }
  }, []);

  async function startGoogleSignIn() {
    const hintedEmail = normalizeEmailValue(setupEmail || email);

    try {
      if (hintedEmail) {
        window.sessionStorage.setItem(GOOGLE_EMAIL_HINT_STORAGE_KEY, hintedEmail);
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

      const result = await signIn("credentials", {
        email: setupEmail,
        password: setupPassword,
        callbackUrl: "/post-login",
        redirect: false,
      });

      if (!result || result.error) {
        setMessage("Mot de passe créé. Vous pouvez maintenant vous connecter.");
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
    <main className="min-h-screen bg-[#eef2f6] text-slate-950 dark:bg-[#0b111a] dark:text-white">
      <div className="grid min-h-screen lg:grid-cols-[1.38fr,0.98fr]">
        <section className="relative hidden overflow-hidden bg-[#07124c] lg:block">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,17,74,0.86),rgba(6,17,74,0.98))]" />
          <div className="absolute -left-24 top-[-6%] h-168 w-168 rounded-full border border-sky-400/30" />
          <div className="absolute -left-10 top-[12%] h-152 w-152 rounded-full border border-sky-400/20" />
          <div className="absolute left-[16%] top-[-10%] h-224 w-224 rounded-full border border-sky-400/15" />
          <div className="relative flex min-h-screen flex-col justify-between px-10 py-12 text-white xl:px-16">
            <div>
              <Link
                href="/"
                className="inline-flex rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-[11px] font-semibold tracking-[0.24em] text-white/80 transition hover:bg-white/10"
              >
                THEBEST SARL WORKSPACE
              </Link>

              <div className="mt-24 max-w-xl">
                <p className="text-sm font-medium uppercase tracking-[0.22em] text-sky-200/80">
                  Authentification securisee
                </p>
                <h1 className="mt-6 text-5xl font-semibold leading-[1.05] text-white xl:text-6xl">
                  Espace de travail
                  <br />
                  THEBEST SARL
                </h1>
                <p className="mt-8 max-w-lg text-base leading-7 text-white/72">
                  Connexion professionnelle avec premiere entree Google, creation du mot de passe, puis validation OTP unique avant ouverture complete de l'espace.
                </p>
              </div>
            </div>

            <div className="grid max-w-2xl gap-4 xl:grid-cols-3">
              {[
                { step: "01", title: "Premiere entree", text: "Google n'est accepte que pour un compte sans mot de passe configure." },
                { step: "02", title: "Mot de passe", text: "L'email recupere permet ensuite de definir et confirmer le mot de passe." },
                { step: "03", title: "Validation OTP", text: "Le code recu par email finalise l'activation une seule fois." },
              ].map((item) => (
                <div key={item.step} className="rounded-2xl border border-white/12 bg-white/6 p-4 backdrop-blur-sm">
                  <p className="text-[11px] font-semibold tracking-[0.25em] text-sky-200/70">{item.step}</p>
                  <h2 className="mt-3 text-sm font-semibold text-white">{item.title}</h2>
                  <p className="mt-2 text-xs leading-5 text-white/65">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex min-h-screen items-start justify-center bg-white px-5 py-8 dark:bg-[#0f1319] sm:px-8 lg:px-10 lg:py-12">
          <div className="w-full max-w-md">
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-red-800 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 h-2.5 w-2.5 rounded-full bg-red-500" />
                <div>
                  <p className="text-sm font-semibold">Alerte de securite</p>
                  <p className="mt-1 text-sm leading-6 text-red-700/90 dark:text-red-200/80">
                    Utilisez toujours le bon compte Google ou votre email professionnel pour acceder a la plateforme THEBEST SARL.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-8">
              <p className="text-sm text-slate-500 dark:text-white/45">
                {setupEmail || email ? normalizeEmailValue(setupEmail || email) : "Acces utilisateur"}
              </p>
              <h2 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 dark:text-white">
                Connexion
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-white/65">
                Saisissez votre email et votre mot de passe si votre compte est deja active. Pour une premiere entree, passez par Google puis finalisez la creation du mot de passe.
              </p>
            </div>

            <div className="mt-8 space-y-5">
              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-200">
                  {error}
                </div>
              ) : null}
              {message ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200">
                  {message}
                </div>
              ) : null}

              <form onSubmit={handleCredentialsSignIn} className="space-y-4">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-[0.15em] text-slate-500 dark:text-white/48">Obligatoire</p>
                  <label className="mb-1.5 block text-sm font-medium text-slate-800 dark:text-white/88">Email professionnel</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 outline-none transition focus:border-slate-500 dark:border-white/15 dark:bg-white/5 dark:text-white dark:focus:border-white/30"
                    placeholder="vous@thebest.com"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-800 dark:text-white/88">Mot de passe</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 outline-none transition focus:border-slate-500 dark:border-white/15 dark:bg-white/5 dark:text-white dark:focus:border-white/30"
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

              <div className="border-t border-slate-200 pt-5 dark:border-white/10">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-950 dark:text-white">Premiere connexion</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-white/62">
                      Si votre compte n'a pas encore de mot de passe, choisissez le bon compte Google, puis terminez la configuration avec mot de passe et OTP.
                    </p>
                  </div>
                  <div className={`rounded-full px-3 py-1 text-[11px] font-semibold tracking-[0.16em] ${passwordAuthActive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200" : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200"}`}>
                    {passwordAuthActive ? "ACTIF" : "EN ATTENTE"}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void startGoogleSignIn()}
                  disabled={loading}
                  className="mt-4 flex w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-3.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
                >
                  {loading ? "Ouverture de Google..." : "Continuer avec Google"}
                </button>

                <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-white/48">
                  Le selecteur de compte Google vous permet d'utiliser plusieurs adresses sur un meme appareil. Une fois le mot de passe cree, les connexions suivantes se feront par email et mot de passe.
                </p>
              </div>

              <div className="border-t border-slate-200 pt-5 dark:border-white/10">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-950 dark:text-white">Activation du mot de passe</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-white/62">
                      L'email est recupere automatiquement apres la premiere entree Google. Creez ensuite le mot de passe avant de recevoir et valider le code OTP.
                    </p>
                  </div>
                  <div className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-slate-600 dark:bg-white/10 dark:text-white/60">
                    OTP EMAIL
                  </div>
                </div>

                {!passwordAuthActive ? (
                  <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-white/15 dark:bg-white/5 dark:text-white/60">
                    L'ouverture de ce parcours est planifiee pour le {launchAtLabel}.
                  </div>
                ) : null}

                <form onSubmit={requestSetupCode} className="mt-4 space-y-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-800 dark:text-white/88">Email</label>
                    <input
                      type="email"
                      value={setupEmail}
                      onChange={(event) => setSetupEmail(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 outline-none transition focus:border-slate-500 dark:border-white/15 dark:bg-white/5 dark:text-white dark:focus:border-white/30"
                      placeholder="vous@thebest.com"
                      required
                      readOnly={prefilledSetupEmail}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-800 dark:text-white/88">Nouveau mot de passe</label>
                    <input
                      type="password"
                      value={setupPassword}
                      onChange={(event) => setSetupPassword(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 outline-none transition focus:border-slate-500 dark:border-white/15 dark:bg-white/5 dark:text-white dark:focus:border-white/30"
                      placeholder="Minimum 8 caracteres avec lettres et chiffres"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-800 dark:text-white/88">Confirmer le mot de passe</label>
                    <input
                      type="password"
                      value={setupPasswordConfirmation}
                      onChange={(event) => setSetupPasswordConfirmation(event.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-950 outline-none transition focus:border-slate-500 dark:border-white/15 dark:bg-white/5 dark:text-white dark:focus:border-white/30"
                      placeholder="Retapez le mot de passe"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading || !passwordAuthActive}
                    className="flex w-full items-center justify-center rounded-lg border border-slate-300 bg-slate-50 px-4 py-3.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
                  >
                    {loading ? "Verification..." : "Continuer et recevoir l'OTP"}
                  </button>
                </form>

                {setupRequested ? (
                  <form onSubmit={confirmPasswordSetup} className="mt-5 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-950 dark:text-white">Application d'authentification</p>
                      <button
                        type="button"
                        onClick={() => {
                          setSetupRequested(false);
                          setSetupCode("");
                          setMessage("");
                          setError("");
                        }}
                        className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-white/50 dark:hover:text-white"
                      >
                        Recommencer
                      </button>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-800 dark:text-white/88">Code recu par email</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={setupCode}
                        onChange={(event) => setSetupCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        className="w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-center text-lg tracking-[0.35em] text-slate-950 outline-none transition focus:border-slate-500 dark:border-white/15 dark:bg-[#0b0f14] dark:text-white dark:focus:border-white/30"
                        placeholder="000000"
                        required
                      />
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 dark:border-white/10 dark:bg-[#0b0f14] dark:text-white/70">
                      <p className="font-medium text-slate-900 dark:text-white">Email</p>
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
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}