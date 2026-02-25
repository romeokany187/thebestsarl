"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";

export default function SignInPage() {
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
            Connecte-toi avec Google pour accéder à ton espace de travail.
          </h1>
          <p className="mt-4 max-w-xl text-sm text-black/65 dark:text-white/65">
            Authentification sécurisée via Google. Si ton compte Google a la double authentification activée,
            elle sera utilisée automatiquement pendant la connexion.
          </p>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-zinc-900 sm:p-8">
          <h2 className="text-xl font-semibold">Connexion</h2>
          <p className="mt-2 text-sm text-black/60 dark:text-white/60">Méthode unique: compte Gmail autorisé.</p>

          <button
            onClick={() => signIn("google", { callbackUrl: "/reports" })}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-black/15 px-4 py-3 text-sm font-semibold transition hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Continuer avec Google
          </button>

          <p className="mt-4 text-xs text-black/50 dark:text-white/50">
            En vous connectant, vous acceptez les règles d&apos;accès de la plateforme.
          </p>
        </section>
      </div>
    </main>
  );
}
