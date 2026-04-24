import Link from "next/link";
import { type AppModule, type AppRole, hasModuleAccess } from "@/lib/rbac";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { jobTitleLabel } from "@/lib/assignment";
import { InboxRealtimeLink } from "@/components/inbox-realtime-link";
import { LogoutButton } from "@/components/logout-button";
import { SessionIdleGuard } from "@/components/session-idle-guard";
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
    href: "/comptabilite",
    label: "Comptabilité",
    module: "payments" as AppModule,
    roles: ["ADMIN", "ACCOUNTANT", "EMPLOYEE"] as AppRole[],
    show: ({ role, jobTitle }: { role: AppRole; jobTitle?: string | null }) => {
      const normalizedJobTitle = (jobTitle ?? "").trim().toUpperCase();
      return role === "ADMIN" || role === "ACCOUNTANT" || normalizedJobTitle === "COMPTABLE";
    },
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

function displayRoleLabel(role: AppRole, jobTitle?: string | null) {
  const normalizedJobTitle = (jobTitle ?? "").trim().toUpperCase();
  if (role === "EMPLOYEE" && normalizedJobTitle && normalizedJobTitle !== "AGENT_TERRAIN") {
    return jobTitleLabel(normalizedJobTitle);
  }
  if (role === "ADMIN") return "Admin";
  if (role === "DIRECTEUR_GENERAL") return "Directeur Général";
  if (role === "MANAGER") return "Chef d'agence";
  if (role === "ACCOUNTANT") return "Comptable";
  return "Employé";
}

function VerifiedBadge({ tone }: { tone: "gold" | "blue" }) {
  const palette = tone === "gold"
    ? {
        background: "#FCE8A2",
        border: "#F2D36B",
        icon: "#E0AA18",
        glow: "rgba(244, 197, 66, 0.18)",
      }
    : {
        background: "#D6ECFF",
        border: "#9ACFFD",
        icon: "#2F86D6",
        glow: "rgba(47, 155, 244, 0.16)",
      };

  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full align-middle"
      style={{
        marginLeft: 4,
        backgroundColor: palette.background,
        border: `1px solid ${palette.border}`,
        boxShadow: `0 1px 2px ${palette.glow}`,
      }}
    >
      <svg aria-hidden="true" viewBox="0 -960 960 960" width="14" height="14" className="block">
        <path
          d="m344-60-76-128-144-32 14-148-98-112 98-112-14-148 144-32 76-128 136 58 136-58 76 128 144 32-14 148 98 112-98 112 14 148-144 32-76 128-136-58-136 58Zm34-102 102-44 104 44 56-96 110-26-10-112 74-84-74-86 10-112-110-24-58-96-102 44-104-44-56 96-110 24 10 112-74 86 74 84-10 114 110 24 58 96Zm60-176 226-226-56-58-170 170-86-84-56 56 142 142Z"
          fill={palette.icon}
        />
      </svg>
    </span>
  );
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
  let unreadNotifications = 0;

  if (session?.user?.id) {
    try {
      unreadNotifications = await prisma.userNotification.count({
        where: {
          userId: session.user.id,
          isRead: false,
        },
      });
    } catch (error) {
      console.error("[app-shell] notification count error", error);
    }
  }
  const visibleLinks = links.filter((link) => {
    if (!role || !link.roles.includes(role)) {
      return false;
    }

    if (!hasModuleAccess({
      role,
      jobTitle: session?.user?.jobTitle,
      teamName: session?.user?.teamName,
      module: link.module,
    })) {
      return false;
    }

    return typeof link.show === "function"
      ? link.show({ role, jobTitle: session?.user?.jobTitle })
      : true;
  });
  const roleLabel = role ? `Rôle ${displayRoleLabel(role, session?.user?.jobTitle)}` : null;
  const mobileQuickLinks = visibleLinks.filter((link) => ["/", "/sales", "/payments", "/inbox", "/profile"].includes(link.href));

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      {session?.user?.id ? <SessionIdleGuard sessionKey={`${session.user.id}:${session.expires}`} /> : null}
      <div className="min-h-screen w-full">
        <aside className="fixed inset-y-0 left-0 z-40 hidden h-screen w-72 overflow-y-auto border-r border-black/10 bg-white/70 p-5 backdrop-blur md:block dark:border-white/10 dark:bg-zinc-950/70">
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

        <div className="min-h-screen min-w-0 overflow-x-hidden md:pl-72">
          <header className="fixed inset-x-0 top-0 z-50 border-b border-black/10 bg-white/75 px-4 py-4 backdrop-blur sm:px-6 lg:left-72 lg:px-8 2xl:px-10 dark:border-white/10 dark:bg-zinc-950/75 md:left-72">
            <div className="flex flex-wrap items-start justify-between gap-3 sm:items-center">
              <Link href="/" className="rounded-lg p-1 transition hover:bg-black/5 dark:hover:bg-white/10">
                <p className="text-sm font-semibold tracking-tight">THEBEST SARL</p>
                <p className="text-xs text-black/60 dark:text-white/60">Gestion de projet et opérations</p>
              </Link>
              {/* Badge rôle et notifications supprimés de la navbar */}
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                <ThemeToggle />
                {session?.user?.name ? (
                  <div className="flex items-center gap-2 rounded-xl border border-black/10 bg-white px-3 py-1.5 text-right dark:border-white/10 dark:bg-zinc-900">
                    <span className="text-xs font-semibold leading-tight flex items-center gap-1">
                      {session.user.name}
                      {session.user.role && session.user.teamName ? (
                        session.user.role === "ADMIN" || session.user.role === "DIRECTEUR_GENERAL" ? (
                          <VerifiedBadge tone="gold" />
                        ) : (
                          <VerifiedBadge tone="blue" />
                        )
                      ) : null}
                    </span>
                  </div>
                ) : null}
                {session?.user?.email ? <LogoutButton /> : null}
              </div>
            </div>

            <nav className="tickets-scroll mt-4 flex gap-2 overflow-x-auto pb-1 md:hidden">
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

          <main className="mobile-safe-area-bottom min-w-0 px-4 pt-32 pb-24 sm:px-6 md:pt-24 lg:px-8 lg:pb-8 2xl:px-10">
            {accessNote ? (
              <p className="mb-5 rounded-xl border border-black/10 bg-white px-4 py-3 text-xs text-black/70 shadow-sm dark:border-white/10 dark:bg-zinc-900 dark:text-white/70">
                {accessNote}
              </p>
            ) : null}
            {children}
          </main>

          {mobileQuickLinks.length > 0 ? (
            <nav className="mobile-safe-area-bottom fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white/92 px-3 py-2 backdrop-blur md:hidden dark:border-white/10 dark:bg-zinc-950/92">
              <div className="grid grid-cols-5 gap-2">
                {mobileQuickLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="flex min-w-0 flex-col items-center justify-center rounded-xl px-2 py-2 text-center text-[11px] font-semibold text-black/75 transition hover:bg-black/5 dark:text-white/75 dark:hover:bg-white/10"
                  >
                    <span className="truncate">{link.label}</span>
                    {link.href === "/inbox" && unreadNotifications > 0 ? (
                      <span className="mt-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {unreadNotifications > 99 ? "99+" : unreadNotifications}
                      </span>
                    ) : null}
                  </Link>
                ))}
              </div>
            </nav>
          ) : null}
        </div>
      </div>
    </div>
  );
}
