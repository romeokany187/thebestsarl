import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { DashboardOverview } from "@/components/dashboard-overview";
import type { AppRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSession(authOptions);
  const isConnected = Boolean(session?.user?.email);
  const userRole = session?.user?.role;
  const canAccessExecutiveDashboard = userRole === "ADMIN" || userRole === "MANAGER" || userRole === "ACCOUNTANT";

  if (canAccessExecutiveDashboard) {
    return (
      <AppShell
        role={userRole as AppRole}
        accessNote="Tableau de pilotage interactif: utilisateurs, présences/absences, rapports par employé/fonction et ventes multi-fréquences."
      >
        <section className="mb-6">
          <h1 className="text-2xl font-semibold">Dashboard direction</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Vision complète et interactive de l&apos;activité agence selon la période, la fonction et l&apos;employé.
          </p>
        </section>
        <DashboardOverview />
      </AppShell>
    );
  }

  const highlights = [
    {
      title: "Rapports intelligents",
      text: "Journalier, hebdomadaire, mensuel, annuel avec validation managériale.",
    },
    {
      title: "Présence et performance",
      text: "Pointage, retards, heures supplémentaires et visibilité instantanée.",
    },
    {
      title: "Ventes & commissions",
      text: "Suivi des billets payés/non payés et commissions nettes par compagnie.",
    },
  ];

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0">
        <div className="motif-float absolute -left-16 top-20 h-48 w-48 rounded-full bg-black/5 blur-2xl dark:bg-white/10" />
        <div className="motif-float absolute right-8 top-32 h-56 w-56 rounded-full bg-black/5 blur-2xl dark:bg-white/10" />
        <div className="motif-float absolute bottom-10 left-1/3 h-44 w-44 rounded-full bg-black/5 blur-2xl dark:bg-white/10" />
      </div>

      <header className="border-b border-black/10 bg-white/80 backdrop-blur dark:border-white/10 dark:bg-black/40">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="rounded-md px-2 py-1 text-sm font-semibold tracking-wide transition hover:bg-black/5 dark:hover:bg-white/10">
            THEBEST SARL
          </Link>
          <div className="flex items-center gap-2 text-sm">
            <Link href="/reports" className="rounded-md px-3 py-2 hover:bg-black/5 dark:hover:bg-white/10">
              Produit
            </Link>
            {isConnected ? (
              <>
                <div className="hidden rounded-lg border border-black/10 bg-white px-3 py-1.5 text-right dark:border-white/10 dark:bg-zinc-900 sm:block">
                  <p className="text-xs font-semibold leading-tight">{session?.user?.name ?? "Utilisateur"}</p>
                  <p className="text-[11px] leading-tight text-black/60 dark:text-white/60">{session?.user?.email}</p>
                </div>
                <Link
                  href="/profile"
                  className="rounded-md border border-black/15 px-3 py-2 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Mon profil
                </Link>
              </>
            ) : (
              <Link
                href="/auth/signin"
                className="rounded-md border border-black/15 px-3 py-2 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
              >
                Se connecter
              </Link>
            )}
          </div>
        </div>
      </header>

      <section className="relative z-10 mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.2fr,1fr] lg:px-8 lg:py-24">
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
            {isConnected ? (
              <Link href="/profile" className="rounded-xl border border-black/15 px-5 py-3 text-sm font-semibold dark:border-white/20">
                Voir mon profil
              </Link>
            ) : (
              <Link href="/auth/signin" className="rounded-xl border border-black/15 px-5 py-3 text-sm font-semibold dark:border-white/20">
                Connexion équipe
              </Link>
            )}
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-black/10 bg-white px-4 py-3 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow dark:border-white/10 dark:bg-zinc-900">
              <p className="text-xs text-black/60 dark:text-white/60">Modules</p>
              <p className="text-xl font-semibold">12+</p>
            </div>
            <div className="rounded-xl border border-black/10 bg-white px-4 py-3 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow dark:border-white/10 dark:bg-zinc-900">
              <p className="text-xs text-black/60 dark:text-white/60">Vue direction</p>
              <p className="text-xl font-semibold">Temps réel</p>
            </div>
            <div className="rounded-xl border border-black/10 bg-white px-4 py-3 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow dark:border-white/10 dark:bg-zinc-900">
              <p className="text-xs text-black/60 dark:text-white/60">Accès mobile</p>
              <p className="text-xl font-semibold">Responsive</p>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {highlights.map((item, index) => (
            <article
              key={item.title}
              className="group rounded-2xl border border-black/10 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-md dark:border-white/10 dark:bg-zinc-900"
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">{item.title}</h2>
                <span className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] font-semibold text-black/60 dark:border-white/15 dark:text-white/60">
                  0{index + 1}
                </span>
              </div>
              <p className="text-sm text-black/65 dark:text-white/65">{item.text}</p>
              <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
                <div className="h-full w-2/3 rounded-full bg-black/20 transition-all duration-300 group-hover:w-full dark:bg-white/30" />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="relative z-10 border-t border-black/10 bg-white/50 px-4 py-10 sm:px-6 lg:px-8 dark:border-white/10 dark:bg-zinc-950/40">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-black/70 dark:text-white/70">
            Un cadre de travail moderne, pensé pour la direction et les équipes terrain.
          </p>
          <div className="flex flex-wrap gap-2">
            {isConnected ? (
              <Link href="/profile" className="rounded-lg border border-black/15 px-4 py-2 text-sm font-semibold dark:border-white/20">
                Mon profil
              </Link>
            ) : (
              <Link href="/auth/signin" className="rounded-lg border border-black/15 px-4 py-2 text-sm font-semibold dark:border-white/20">
                Commencer
              </Link>
            )}
            <Link href="/reports" className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">
              Voir les modules
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
