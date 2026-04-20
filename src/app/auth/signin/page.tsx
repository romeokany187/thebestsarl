"use client";

import Link from "next/link";
import { useState } from "react";
import { signIn } from "next-auth/react";

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

  async function handleCredentialsSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
        setError(typeof payload?.error === "string" ? payload.error : "Impossible d'envoyer le code de confirmation.");
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
        setError(typeof payload?.error === "string" ? payload.error : "Impossible de créer le mot de passe.");
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
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:px-8">
        <section>
          <Link
            href="/"
            className="mb-4 inline-flex rounded-full border border-black/15 px-3 py-1 text-xs font-semibold transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            THEBEST SARL Workspace
          </Link>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Connecte-toi avec ton mot de passe pour accéder à ton espace de travail.
          </h1>
          <p className="mt-4 max-w-xl text-sm text-black/65 dark:text-white/65">
            À la première connexion, chaque collaborateur crée son mot de passe via un code de confirmation reçu par email.
            Ensuite, la connexion se fait avec email et mot de passe.
          </p>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-900 sm:p-8">
          <h2 className="text-xl font-semibold">Connexion</h2>
          <p className="mt-2 text-sm text-black/60 dark:text-white/60">Saisissez votre email professionnel et votre mot de passe.</p>

          {error ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
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
                className="w-full rounded-xl border border-black/15 px-4 py-3 text-sm dark:border-white/20 dark:bg-zinc-950"
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
                className="w-full rounded-xl border border-black/15 px-4 py-3 text-sm dark:border-white/20 dark:bg-zinc-950"
                placeholder="Votre mot de passe"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60 dark:bg-white dark:text-black"
            >
              {loading ? "Connexion..." : "Se connecter"}
            </button>
          </form>

          <div className="mt-8 border-t border-black/10 pt-6 dark:border-white/10">
            <h3 className="text-base font-semibold">Première connexion ou mot de passe à créer</h3>
            <p className="mt-1 text-sm text-black/60 dark:text-white/60">
              Entrez votre email, recevez un code à usage unique, puis créez votre mot de passe.
            </p>

            <form onSubmit={requestSetupCode} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Email</label>
                <input
                  type="email"
                  value={setupEmail}
                  onChange={(event) => setSetupEmail(event.target.value)}
                  className="w-full rounded-xl border border-black/15 px-4 py-3 text-sm dark:border-white/20 dark:bg-zinc-950"
                  placeholder="vous@thebest.com"
                  required
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center rounded-xl border border-black/15 px-4 py-3 text-sm font-semibold transition hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
              >
                {loading ? "Envoi..." : "Envoyer le code"}
              </button>
            </form>

            {setupRequested ? (
              <form onSubmit={confirmPasswordSetup} className="mt-5 space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">Code reçu par email</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={setupCode}
                    onChange={(event) => setSetupCode(event.target.value)}
                    className="w-full rounded-xl border border-black/15 px-4 py-3 text-center text-lg tracking-[0.35em] dark:border-white/20 dark:bg-zinc-950"
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
                    className="w-full rounded-xl border border-black/15 px-4 py-3 text-sm dark:border-white/20 dark:bg-zinc-950"
                    placeholder="Au moins 8 caractères"
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Confirmer le mot de passe</label>
                  <input
                    type="password"
                    value={setupPasswordConfirmation}
                    onChange={(event) => setSetupPasswordConfirmation(event.target.value)}
                    className="w-full rounded-xl border border-black/15 px-4 py-3 text-sm dark:border-white/20 dark:bg-zinc-950"
                    placeholder="Retapez le mot de passe"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60 dark:bg-white dark:text-black"
                >
                  {loading ? "Confirmation..." : "Créer mon mot de passe"}
                </button>
              </form>
            ) : null}
          </div>

          <div className="mt-8 border-t border-black/10 pt-6 dark:border-white/10">
            <p className="text-xs text-black/50 dark:text-white/50">
              En vous connectant, vous acceptez les règles d&apos;accès de la plateforme.
            </p>
            <button
              onClick={() => signIn("google", { callbackUrl: "/post-login" })}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-black/15 px-4 py-3 text-sm font-semibold transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Utiliser Google en secours
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
