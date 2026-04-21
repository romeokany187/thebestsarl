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
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(15,61,105,0.14),transparent_34%),linear-gradient(180deg,rgba(247,249,252,0.98),rgba(236,241,247,0.92))] text-foreground dark:bg-[radial-gradient(circle_at_top_left,rgba(124,179,255,0.12),transparent_28%),linear-gradient(180deg,rgba(10,12,16,1),rgba(18,21,27,0.98))]">
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1.05fr,0.95fr] lg:px-8">
        <section className="relative">
          <div className="pointer-events-none absolute -left-10 top-0 h-48 w-48 rounded-full bg-sky-200/35 blur-3xl dark:bg-sky-500/10" />
          <div className="pointer-events-none absolute bottom-0 left-24 h-56 w-56 rounded-full bg-amber-200/30 blur-3xl dark:bg-amber-500/10" />
          <Link
            href="/"
            className="mb-5 inline-flex rounded-full border border-slate-300/70 bg-white/75 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-slate-700 shadow-sm transition hover:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white/75 dark:hover:bg-white/10"
          >
            THEBEST SARL Workspace
          </Link>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl dark:text-white">
            Accès sécurisé à l&apos;espace de travail avec mot de passe personnel et activation guidée.
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-6 text-slate-600 dark:text-white/65">
            Un nouveau collaborateur peut faire une première entrée avec Google si son compte n&apos;a pas encore de mot de passe.
            Ensuite, son email est récupéré automatiquement, il crée son mot de passe, confirme ce mot de passe, puis valide l&apos;OTP reçu par email avant d&apos;accéder à son espace de travail.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              { step: "01", title: "Première entrée", text: "Google reste accepté uniquement pour un compte qui n'a pas encore de mot de passe." },
              { step: "02", title: "Mot de passe défini", text: "L'email du compte est repris automatiquement pour permettre la création et la confirmation du mot de passe." },
              { step: "03", title: "OTP final", text: "Le code OTP valide la création une seule fois, puis les prochaines connexions se font par email et mot de passe." },
            ].map((item) => (
              <div key={item.step} className="rounded-3xl border border-slate-200/80 bg-white/80 p-4 shadow-[0_12px_40px_rgba(15,23,42,0.06)] backdrop-blur dark:border-white/10 dark:bg-white/5 dark:shadow-none">
                <p className="text-[11px] font-semibold tracking-[0.25em] text-slate-400 dark:text-white/40">{item.step}</p>
                <h2 className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{item.title}</h2>
                <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-white/60">{item.text}</p>
              </div>
            ))}
          </div>

          <div className={`mt-8 rounded-3xl border px-5 py-4 shadow-sm ${passwordAuthActive ? "border-emerald-200 bg-emerald-50/90 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100" : "border-amber-200 bg-amber-50/90 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.2em]">
              {passwordAuthActive ? "Système actif" : "Activation programmée"}
            </p>
            <p className="mt-2 text-sm font-medium">
              {passwordAuthActive
                ? "Le parcours d'activation par mot de passe est actif. Google reste limité au tout premier accès d'un compte sans mot de passe."
                : `Le nouveau parcours sera activé demain à 05:00, soit le ${launchAtLabel}.`}
            </p>
            <p className="mt-2 text-xs leading-5 opacity-80">
              Les sessions utilisateur expirent automatiquement après 8 heures. L'OTP n'est pas demandé à chaque reconnexion: il sert uniquement à l'initialisation du mot de passe et ses demandes restent limitées pour éviter les abus.
            </p>
          </div>
        </section>

        <section className="rounded-4xl border border-slate-200/80 bg-white/88 p-6 shadow-[0_24px_90px_rgba(15,23,42,0.08)] backdrop-blur dark:border-white/10 dark:bg-[#0f1319]/92 dark:shadow-none sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Connexion</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-white/60">Utilisez votre email professionnel et votre mot de passe après la première activation.</p>
            </div>
            <div className={`rounded-full px-3 py-1 text-[11px] font-semibold tracking-[0.16em] ${passwordAuthActive ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200" : "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/60"}`}>
              {passwordAuthActive ? "Actif" : "En attente"}
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
              {message}
            </div>
          ) : null}

          <form onSubmit={handleCredentialsSignIn} className="mt-6 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white dark:focus:border-white/30"
                placeholder="vous@thebest.com"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Mot de passe</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white dark:focus:border-white/30"
                placeholder="Votre mot de passe"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading || !passwordAuthActive}
              className="flex w-full items-center justify-center rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950"
            >
              {loading ? "Connexion..." : "Se connecter"}
            </button>
          </form>

          <div className="mt-8 border-t border-slate-200/80 pt-6 dark:border-white/10">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-950 dark:text-white">Première connexion ou mot de passe à créer</h3>
                <p className="mt-1 text-sm text-slate-600 dark:text-white/60">
                  Après la première entrée Google d&apos;un compte sans mot de passe, l&apos;email est repris ici. Définissez le mot de passe du compte, puis entrez le code OTP reçu par email pour ouvrir l&apos;accès.
                </p>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-slate-600 dark:bg-white/10 dark:text-white/60">
                OTP EMAIL
              </div>
            </div>

            {!passwordAuthActive ? (
              <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-4 text-sm text-slate-600 dark:border-white/15 dark:bg-white/5 dark:text-white/60">
                L&apos;ouverture de ce parcours est planifiée pour le {launchAtLabel}. Les formulaires sont préparés mais restent verrouillés jusque-là.
              </div>
            ) : null}

            <form onSubmit={requestSetupCode} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Email</label>
                <input
                  type="email"
                  value={setupEmail}
                  onChange={(event) => setSetupEmail(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white dark:focus:border-white/30"
                  placeholder="vous@thebest.com"
                  required
                  readOnly={prefilledSetupEmail}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Nouveau mot de passe</label>
                <input
                  type="password"
                  value={setupPassword}
                  onChange={(event) => setSetupPassword(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white dark:focus:border-white/30"
                  placeholder="Minimum 8 caractères, avec lettres et chiffres"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Confirmer le mot de passe</label>
                <input
                  type="password"
                  value={setupPasswordConfirmation}
                  onChange={(event) => setSetupPasswordConfirmation(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white dark:border-white/15 dark:bg-white/5 dark:text-white dark:focus:border-white/30"
                  placeholder="Retapez le mot de passe"
                  required
                />
              </div>
              <p className="text-xs leading-5 text-slate-500 dark:text-white/50">
                Définissez d&apos;abord le mot de passe. Si les informations sont valides, un OTP sera envoyé à cet email pour finaliser l&apos;activation.
              </p>
              <button
                type="submit"
                disabled={loading || !passwordAuthActive}
                className="flex w-full items-center justify-center rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/15 dark:text-white dark:hover:bg-white/10"
              >
                {loading ? "Vérification..." : "Continuer et recevoir l'OTP"}
              </button>
            </form>

            {setupRequested ? (
              <form onSubmit={confirmPasswordSetup} className="mt-5 space-y-4 rounded-3xl border border-slate-200/80 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">Validation OTP et ouverture d&apos;accès</p>
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
                  <label className="mb-1 block text-sm font-medium">Code reçu par email</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={setupCode}
                    onChange={(event) => setSetupCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-lg tracking-[0.35em] text-slate-950 outline-none transition focus:border-slate-400 dark:border-white/15 dark:bg-[#0b0f14] dark:text-white dark:focus:border-white/30"
                    placeholder="000000"
                    required
                  />
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-600 dark:border-white/10 dark:bg-[#0b0f14] dark:text-white/70">
                  <p className="font-medium text-slate-900 dark:text-white">Email</p>
                  <p className="mt-1 break-all">{setupEmail}</p>
                </div>
                <p className="text-xs leading-5 text-slate-500 dark:text-white/50">
                  Si le code OTP est correct, le mot de passe que vous venez de définir sera activé et l&apos;accès à l&apos;espace de travail sera immédiatement ouvert.
                </p>
                <button
                  type="submit"
                  disabled={loading || !passwordAuthActive}
                  className="flex w-full items-center justify-center rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950"
                >
                  {loading ? "Validation..." : "Valider l'OTP et accéder à l'espace"}
                </button>
              </form>
            ) : null}
          </div>

          {!passwordAuthActive ? (
            <div className="mt-8 border-t border-slate-200/80 pt-6 dark:border-white/10">
              <p className="text-xs leading-5 text-slate-500 dark:text-white/50">
                Pendant la période de préparation, Google reste disponible pour l&apos;accès courant. Après activation, seule la connexion email + mot de passe restera autorisée.
              </p>
              <button
                type="button"
                onClick={() => void startGoogleSignIn()}
                disabled={loading}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-white/15 dark:text-white dark:hover:bg-white/10"
              >
                {loading ? "Ouverture de Google..." : "Continuer avec Google pour aujourd&apos;hui"}
              </button>
            </div>
          ) : (
            <div className="mt-8 border-t border-slate-200/80 pt-6 dark:border-white/10">
              <p className="text-xs leading-5 text-slate-500 dark:text-white/50">
                Après activation, Google ne sert plus qu&apos;à la toute première entrée d&apos;un compte sans mot de passe. Une fois le mot de passe créé, les connexions suivantes se font uniquement avec email + mot de passe, sans nouveau code OTP à chaque session.
              </p>
              <button
                type="button"
                onClick={() => void startGoogleSignIn()}
                disabled={loading}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-white/15 dark:text-white dark:hover:bg-white/10"
              >
                {loading ? "Ouverture de Google..." : "Première connexion avec Google"}
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}