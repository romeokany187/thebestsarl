import Link from "next/link";
import { type AppModule, type AppRole, hasModuleAccess } from "@/lib/rbac";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { InboxRealtimeLink } from "@/components/inbox-realtime-link";
import { LogoutButton } from "@/components/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { prisma } from "@/lib/prisma";

const links = [
  { href: "/", label: "Dashboard", module: "home" as AppModule, roles: ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[] },
  {
    href: "/profile",
    label: "Profil",
    module: "profile" as AppModule,
    roles: ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/inbox",
    label: "Notifications",
    module: "profile" as AppModule,
    roles: ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/admin/approvals",
    label: "À approuver",
    module: "admin" as AppModule,
    roles: ["ADMIN", "DIRECTEUR_GENERAL"] as AppRole[],
  },
  {
    href: "/admin/ordres-paiement",
    label: "OP - Espace Admin",
    module: "admin" as AppModule,
    roles: ["ADMIN"] as AppRole[],
  },
  {
    href: "/sales",
    label: "Ventes",
    module: "sales" as AppModule,
    roles: ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/tickets",
    label: "Billets",
    module: "tickets" as AppModule,
    roles: ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/factures",
    label: "Factures",
    module: "invoices" as AppModule,
    roles: ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/payments",
    label: "Paiements",
    module: "payments" as AppModule,
    roles: ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT", "EMPLOYEE"] as AppRole[],
  },
  {
    href: "/deposit",
    label: "Dépôts compagnies",
    module: "payments" as AppModule,
    roles: ["ADMIN", "DIRECTEUR_GENERAL", "ACCOUNTANT", "EMPLOYEE"] as AppRole[],
  },
  {
    href: "/dg/ordres-paiement",
    label: "OP - Espace DG",
    module: "home" as AppModule,
    roles: ["DIRECTEUR_GENERAL"] as AppRole[],
  },
  {
    href: "/attendance",
    label: "Présences",
    module: "attendance" as AppModule,
    roles: ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/teams",
    label: "Équipes",
    module: "teams" as AppModule,
    roles: ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/reports",
    label: "Rapports",
    module: "reports" as AppModule,
    roles: ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/approvisionnement",
    label: "Approvisionnement",
    module: "procurement" as AppModule,
    roles: ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/archives",
    label: "Archives",
    module: "archives" as AppModule,
    roles: ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/news",
    label: "Nouvelles",
    module: "news" as AppModule,
    roles: ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/settings",
    label: "Paramètres",
    module: "settings" as AppModule,
    roles: ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/audit",
    label: "Audit",
    module: "audit" as AppModule,
    roles: ["ADMIN", "DIRECTEUR_GENERAL", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/admin/logs",
    label: "Logs activités",
    module: "admin" as AppModule,
    roles: ["ADMIN", "DIRECTEUR_GENERAL"] as AppRole[],
  },
  { href: "/admin", label: "Admin", module: "admin" as AppModule, roles: ["ADMIN", "DIRECTEUR_GENERAL"] as AppRole[] },
];

function displayRoleLabel(role: AppRole) {
  if (role === "ADMIN") return "Admin";
  if (role === "DIRECTEUR_GENERAL") return "Directeur Général";
  if (role === "MANAGER") return "Chef d'agence";
  if (role === "ACCOUNTANT") return "Comptable";
  return "Employé";
}

export async function AppShell({
  children,
  role,
  accessNote,
}: {
  children: React.ReactNode;
  role?: AppRole;
  accessNote?: string;
}) {
  const session = await getServerSession(authOptions);
  const [unreadNotifications, latestNotification] = session?.user?.id
    ? await Promise.all([
        prisma.userNotification.count({
          where: {
            userId: session.user.id,
            isRead: false,
          },
        }),
        prisma.userNotification.findFirst({
          where: { userId: session.user.id },
          select: { id: true },
          orderBy: { createdAt: "desc" },
        }),
      ])
    : [0, null];
  const visibleLinks = links.filter((link) => {
    if (!role || !link.roles.includes(role)) {
      return false;
    }

    return hasModuleAccess({
      role,
      jobTitle: session?.user?.jobTitle,
      teamName: session?.user?.teamName,
      module: link.module,
    });
  });
  const roleLabel = role ? `Rôle ${displayRoleLabel(role)}` : null;

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <div className="flex min-h-screen w-full">
        <aside className="sticky top-0 hidden h-screen w-72 shrink-0 overflow-y-auto border-r border-black/10 bg-white/70 p-5 backdrop-blur md:block dark:border-white/10 dark:bg-zinc-950/70">
          <div className="mb-6">
            <Link href="/" className="block rounded-lg p-1 transition hover:bg-black/5 dark:hover:bg-white/10">
              <p className="text-base font-semibold tracking-tight">THEBEST SARL</p>
              <p className="text-xs text-black/55 dark:text-white/55">Travel Agency Workspace</p>
            </Link>
          </div>

          {roleLabel ? (
            <div className="mb-5 rounded-xl border border-black/10 bg-black/5 px-3 py-2 text-xs font-semibold dark:border-white/15 dark:bg-white/10">
              {roleLabel}
            </div>
          ) : null}

          <nav className="space-y-1">
            {visibleLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-black/75 transition hover:bg-black/5 hover:text-black dark:text-white/75 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <span>{link.label}</span>
                {link.href === "/inbox" && unreadNotifications > 0 ? (
                  <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                    {unreadNotifications > 99 ? "99+" : unreadNotifications}
                  </span>
                ) : null}
              </Link>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 border-b border-black/10 bg-white/75 px-4 py-4 backdrop-blur sm:px-6 lg:px-8 2xl:px-10 dark:border-white/10 dark:bg-zinc-950/75">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href="/" className="rounded-lg p-1 transition hover:bg-black/5 dark:hover:bg-white/10">
                <p className="text-sm font-semibold tracking-tight">THEBEST SARL</p>
                <p className="text-xs text-black/60 dark:text-white/60">Gestion de projet et opérations</p>
              </Link>
              {/* Badge rôle et notifications supprimés de la navbar */}
              <ThemeToggle />
              {session?.user?.name ? (
                <div className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-right flex items-center gap-2 dark:border-white/10 dark:bg-zinc-900">
                  <span className="text-xs font-semibold leading-tight flex items-center gap-1">
                    {session.user.name}
                    {/* Badge verified si rôle et équipe */}
                    {session.user.role && session.user.teamName ? (
                      <svg aria-label="Compte vérifié" viewBox="0 0 20 20" fill="currentColor" className="text-blue-500 w-4 h-4" style={{display:'inline'}}>
                        <title>Compte vérifié</title>
                        <circle cx="10" cy="10" r="10" fill="#3b82f6" />
                        <path d="M7.5 10.5l2 2 3-3" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </span>
                </div>
              ) : null}
              {session?.user?.email ? <LogoutButton /> : null}
            </div>

            <nav className="mt-4 flex gap-2 overflow-x-auto pb-1 md:hidden">
              {visibleLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="shrink-0 rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-black/75 dark:border-white/15 dark:bg-zinc-900 dark:text-white/75"
                >
                  {link.label}
                  {link.href === "/inbox" && unreadNotifications > 0 ? ` (${unreadNotifications > 99 ? "99+" : unreadNotifications})` : ""}
                </Link>
              ))}
            </nav>
          </header>

          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 2xl:px-10 lg:py-8">
            {accessNote ? (
              <p className="mb-5 rounded-xl border border-black/10 bg-white px-4 py-3 text-xs text-black/70 shadow-sm dark:border-white/10 dark:bg-zinc-900 dark:text-white/70">
                {accessNote}
              </p>
            ) : null}
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
