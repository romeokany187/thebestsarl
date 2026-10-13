import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { AppShell } from "@/components/app-shell";
import { DashboardOverview } from "@/components/dashboard-overview";
import { WorkspaceHome } from "@/components/workspace-home";
import { getUserModuleAccessMap } from "@/lib/user-module-access";
import { buildHomeQuickActions, homeWelcomeTitle } from "@/lib/workspace-home";
import { extractRole, type AppRole } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSession(authOptions);
  const isConnected = Boolean(session?.user?.email);

  if (isConnected && session?.user) {
    const role = extractRole(session.user.role, session.user.jobTitle) ?? "EMPLOYEE";
    const accessMap = await getUserModuleAccessMap(session.user.id);
    const actions = buildHomeQuickActions({
      role: role as AppRole,
      jobTitle: session.user.jobTitle,
      teamName: session.user.teamName,
      accessMap,
    });
    const title = homeWelcomeTitle(role as AppRole, session.user.jobTitle);
    const isDirectionGenerale = (session.user.jobTitle ?? "") === "DIRECTION_GENERALE";
    const showExecutiveDashboard = role === "ADMIN" || isDirectionGenerale;

    return (
      <AppShell role={role as AppRole}>
        <WorkspaceHome title={title} actions={actions} />
        {showExecutiveDashboard ? (
          <section className="mt-10 space-y-4">
            <h2 className="text-lg font-semibold">Synthèse direction</h2>
            <DashboardOverview />
          </section>
        ) : null}
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
            <Link href="/auth/signin" className="rounded-md border border-black/15 px-3 py-2 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10">
              Connexion équipe
            </Link>
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
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/auth/signin" className="rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white dark:bg-white dark:text-black">
              Connexion équipe
            </Link>
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
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
