import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-black/10 bg-white/80 backdrop-blur dark:border-white/10 dark:bg-black/40">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-sm font-semibold tracking-wide">THEBEST SARL</p>
          <div className="flex items-center gap-2 text-sm">
            <Link href="/reports" className="rounded-md px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10">
              Produit
            </Link>
            <Link
              href="/api/auth/signin"
              className="rounded-md border border-black/15 px-3 py-2 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Se connecter
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.2fr,1fr] lg:px-8 lg:py-24">
        <div>
          <p className="mb-3 inline-flex rounded-full border border-black/15 px-3 py-1 text-xs font-semibold dark:border-white/20">
            Plateforme de gestion d&apos;agence de voyage
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Gère les équipes, rapports, présences et ventes dans un seul espace.
          </h1>
          <p className="mt-5 max-w-xl text-base text-black/65 dark:text-white/65">
            Une expérience claire, moderne et professionnelle pour piloter l&apos;activité quotidienne,
            hebdomadaire, mensuelle et annuelle de ton agence.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/reports" className="rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white dark:bg-white dark:text-black">
              Découvrir la plateforme
            </Link>
            <Link href="/api/auth/signin" className="rounded-xl border border-black/15 px-5 py-3 text-sm font-semibold dark:border-white/20">
              Connexion équipe
            </Link>
          </div>
        </div>

        <div className="grid gap-3">
          <article className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold">Rapports de travail</h2>
            <p className="mt-2 text-sm text-black/65 dark:text-white/65">Journalier, hebdomadaire, mensuel, annuel avec validation manager.</p>
          </article>
          <article className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold">Présences & performance</h2>
            <p className="mt-2 text-sm text-black/65 dark:text-white/65">Pointage, retards, heures supp. et suivi opérationnel des équipes.</p>
          </article>
          <article className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold">Ventes & commissions</h2>
            <p className="mt-2 text-sm text-black/65 dark:text-white/65">Billets payés/non payés, commissions brutes et nettes par compagnie.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
