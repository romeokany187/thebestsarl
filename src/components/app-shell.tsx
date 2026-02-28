import Link from "next/link";
import type { AppRole } from "@/lib/rbac";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { LogoutButton } from "@/components/logout-button";

const links = [
  { href: "/", label: "Dashboard", roles: ["ADMIN", "MANAGER", "ACCOUNTANT"] as AppRole[] },
  {
    href: "/reports",
    label: "Rapports",
    roles: ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/attendance",
    label: "Présences",
    roles: ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/sales",
    label: "Ventes",
    roles: ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/tickets",
    label: "Billets",
    roles: ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/payments",
    label: "Paiements",
    roles: ["ADMIN", "MANAGER", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/teams",
    label: "Équipes",
    roles: ["ADMIN", "MANAGER", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/projects",
    label: "Nouvelles",
    roles: ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/calendar",
    label: "Calendrier",
    roles: ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/inbox",
    label: "Inbox",
    roles: ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/settings",
    label: "Paramètres",
    roles: ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  {
    href: "/profile",
    label: "Profil",
    roles: ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"] as AppRole[],
  },
  { href: "/admin", label: "Admin", roles: ["ADMIN"] as AppRole[] },
];

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
  const visibleLinks = links.filter((link) => !role || link.roles.includes(role));
  const roleLabel = role ? `Rôle ${role}` : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
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
                className="block rounded-lg px-3 py-2 text-sm font-medium text-black/75 transition hover:bg-black/5 hover:text-black dark:text-white/75 dark:hover:bg-white/10 dark:hover:text-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 border-b border-black/10 bg-white/75 px-4 py-4 backdrop-blur sm:px-6 lg:px-8 dark:border-white/10 dark:bg-zinc-950/75">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href="/" className="rounded-lg p-1 transition hover:bg-black/5 dark:hover:bg-white/10">
                <p className="text-sm font-semibold tracking-tight">THEBEST SARL</p>
                <p className="text-xs text-black/60 dark:text-white/60">Gestion de projet et opérations</p>
              </Link>
              {roleLabel ? (
                <span className="rounded-full border border-black/15 px-3 py-1 text-xs font-semibold dark:border-white/20">
                  {roleLabel}
                </span>
              ) : null}
              {session?.user?.email ? (
                <div className="rounded-xl border border-black/10 bg-white px-3 py-1.5 text-right dark:border-white/10 dark:bg-zinc-900">
                  <p className="text-xs font-semibold leading-tight">{session.user.name ?? "Utilisateur"}</p>
                  <p className="text-[11px] leading-tight text-black/60 dark:text-white/60">{session.user.email}</p>
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
                </Link>
              ))}
            </nav>
          </header>

          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
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
