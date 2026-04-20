"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import { isPasswordAuthActive, passwordAuthLaunchAtIso } from "@/lib/auth-rollout";

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

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupEmail, setSetupEmail] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [setupPassword, setSetupPassword] = useState("");
  const [setupPasswordConfirmation, setSetupPasswordConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [setupRequested, setSetupRequested] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const passwordAuthActive = useMemo(() => isPasswordAuthActive(), []);
  const launchAtLabel = useMemo(
    () => new Date(passwordAuthLaunchAtIso()).toLocaleString("fr-FR", {
      timeZone: "Africa/Kinshasa",
      dateStyle: "full",
      timeStyle: "short",
    }),
    [],
  );

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
      setMessage(payload?.message ?? "Un code a été envoyé à votre adresse email.");
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
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(15,61,105,0.14),_transparent_34%),linear-gradient(180deg,_rgba(247,249,252,0.98),_rgba(236,241,247,0.92))] text-foreground dark:bg-[radial-gradient(circle_at_top_left,_rgba(124,179,255,0.12),_transparent_28%),linear-gradient(180deg,_rgba(10,12,16,1),_rgba(18,21,27,0.98))]">
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
            Accès sécurisé à l&apos;espace de travail avec mot de passe personnel et confirmation par email.
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-6 text-slate-600 dark:text-white/65">
            Chaque collaborateur reçoit un code unique par email pour confirmer la création de son mot de passe.
            Une fois activé, l&apos;accès se fait directement par email et mot de passe, avec Google conservé comme secours.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              { step: "01", title: "Email vérifié", text: "Le code est envoyé uniquement à l'adresse du compte utilisateur existant." },
              { step: "02", title: "Code unique", text: "Le code OTP expire vite et ne peut être utilisé qu'une seule fois." },
              { step: "03", title: "Connexion simple", text: "Après activation, l'utilisateur accède à son espace avec ses propres identifiants." },
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
                ? "Le nouveau parcours de connexion par mot de passe est maintenant actif."
                : `Le nouveau parcours sera activé demain à 05:00, soit le ${launchAtLabel}.`}
            </p>
          </div>
        </section>

        <section className="rounded-[32px] border border-slate-200/80 bg-white/88 p-6 shadow-[0_24px_90px_rgba(15,23,42,0.08)] backdrop-blur dark:border-white/10 dark:bg-[#0f1319]/92 dark:shadow-none sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-950 dark:text-white">Connexion</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-white/60">Saisissez votre email professionnel et votre mot de passe.</p>
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
                  Entrez votre email, recevez un code à usage unique, puis créez votre mot de passe.
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
                />
              </div>
              <button
                type="submit"
                disabled={loading || !passwordAuthActive}
                className="flex w-full items-center justify-center rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/15 dark:text-white dark:hover:bg-white/10"
              >
                {loading ? "Envoi..." : "Envoyer le code"}
              </button>
            </form>

            {setupRequested ? (
              <form onSubmit={confirmPasswordSetup} className="mt-5 space-y-4 rounded-3xl border border-slate-200/80 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">Confirmation du mot de passe</p>
                  <button
                    type="button"
                    onClick={() => {
                      setSetupRequested(false);
                      setSetupCode("");
                      setSetupPassword("");
                      setSetupPasswordConfirmation("");
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
                <div>
                  <label className="mb-1 block text-sm font-medium">Nouveau mot de passe</label>
                  <input
                    type="password"
                    value={setupPassword}
                    onChange={(event) => setSetupPassword(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-400 dark:border-white/15 dark:bg-[#0b0f14] dark:text-white dark:focus:border-white/30"
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
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-400 dark:border-white/15 dark:bg-[#0b0f14] dark:text-white dark:focus:border-white/30"
                    placeholder="Retapez le mot de passe"
                    required
                  />
                </div>
                <p className="text-xs leading-5 text-slate-500 dark:text-white/50">
                  Le mot de passe doit contenir au moins 8 caractères, avec au moins une lettre et un chiffre.
                </p>
                <button
                  type="submit"
                  disabled={loading || !passwordAuthActive}
                  className="flex w-full items-center justify-center rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:opacity-92 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950"
                >
                  {loading ? "Confirmation..." : "Créer mon mot de passe"}
                </button>
              </form>
            ) : null}
          </div>

          <div className="mt-8 border-t border-slate-200/80 pt-6 dark:border-white/10">
            <p className="text-xs leading-5 text-slate-500 dark:text-white/50">
              En vous connectant, vous acceptez les règles d&apos;accès de la plateforme. En cas de blocage exceptionnel, Google reste disponible comme secours contrôlé.
            </p>
            <button
              onClick={() => signIn("google", { callbackUrl: "/post-login" })}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-white/15 dark:text-white dark:hover:bg-white/10"
            >
              Utiliser Google en secours
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
