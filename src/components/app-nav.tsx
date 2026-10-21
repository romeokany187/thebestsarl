"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export type AppNavLink = {
  href: string;
  label: string;
};

type NavGroup = "quotidien" | "finance" | "organisation" | "admin";

const GROUP_ORDER: NavGroup[] = ["quotidien", "finance", "organisation", "admin"];

const GROUP_LABEL: Record<NavGroup, string> = {
  quotidien: "Quotidien",
  finance: "Caisse et finance",
  organisation: "Organisation",
  admin: "Administration",
};

const GROUP_BY_HREF: Record<string, NavGroup> = {
  "/": "quotidien",
  "/profile": "quotidien",
  "/inbox": "quotidien",
  "/sales": "quotidien",
  "/factures": "quotidien",
  "/payments": "finance",
  "/recouvrement": "finance",
  "/comptabilite": "finance",
  "/deposit": "finance",
  "/dg/ordres-paiement": "finance",
  "/admin/approvals": "finance",
  "/admin/ordres-paiement": "finance",
  "/attendance": "organisation",
  "/teams": "organisation",
  "/reports": "organisation",
  "/approvisionnement": "organisation",
  "/archives": "organisation",
  "/news": "organisation",
  "/settings": "organisation",
  "/audit": "organisation",
  "/relation-publique": "organisation",
  "/admin/logs": "admin",
  "/autorisations": "admin",
  "/admin": "admin",
};

const MOBILE_QUICK = ["/", "/sales", "/payments", "/inbox"];

function isActive(href: string, pathname: string) {
  if (href === "/") return pathname === "/";
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function groupLinks(links: AppNavLink[]) {
  return GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABEL[group],
    links: links.filter((link) => (GROUP_BY_HREF[link.href] ?? "organisation") === group),
  })).filter((section) => section.links.length > 0);
}

function NavItem({
  link,
  pathname,
  unread,
  onNavigate,
}: {
  link: AppNavLink;
  pathname: string;
  unread: number;
  onNavigate?: () => void;
}) {
  const active = isActive(link.href, pathname);
  return (
    <Link
      href={link.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition ${
        active
          ? "bg-black text-white dark:bg-white dark:text-black"
          : "text-black/75 hover:bg-black/5 hover:text-black dark:text-white/75 dark:hover:bg-white/10 dark:hover:text-white"
      }`}
    >
      <span>{link.label}</span>
      {link.href === "/inbox" && unread > 0 ? (
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-white text-red-700 dark:bg-black dark:text-red-300" : "bg-red-600 text-white"}`}>
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}

export function AppSidebarNav({
  links,
  unread,
}: {
  links: AppNavLink[];
  unread: number;
}) {
  const pathname = usePathname();
  const sections = groupLinks(links);

  return (
    <nav className="space-y-5" aria-label="Modules">
      {sections.map((section) => (
        <div key={section.group}>
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
            {section.label}
          </p>
          <div className="space-y-1">
            {section.links.map((link) => (
              <NavItem key={link.href} link={link} pathname={pathname} unread={unread} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function AppMobileNav({
  links,
  unread,
}: {
  links: AppNavLink[];
  unread: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const quick = MOBILE_QUICK.map((href) => links.find((link) => link.href === href)).filter((link): link is AppNavLink => Boolean(link));
  const sections = groupLinks(links);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Fermer le menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-16 max-h-[70vh] overflow-y-auto rounded-t-2xl border border-black/10 bg-white p-4 shadow-2xl dark:border-white/10 dark:bg-zinc-950">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">Tous les modules</p>
              <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1 text-xs font-semibold text-black/60 dark:text-white/60">
                Fermer
              </button>
            </div>
            <div className="space-y-4">
              {sections.map((section) => (
                <div key={section.group}>
                  <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-black/40 dark:text-white/40">
                    {section.label}
                  </p>
                  <div className="space-y-1">
                    {section.links.map((link) => (
                      <NavItem key={link.href} link={link} pathname={pathname} unread={unread} onNavigate={() => setOpen(false)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <nav className="mobile-safe-area-bottom fixed inset-x-0 bottom-0 z-50 border-t border-black/10 bg-white/95 px-2 py-2 backdrop-blur md:hidden dark:border-white/10 dark:bg-zinc-950/95" aria-label="Navigation rapide">
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${quick.length + 1}, minmax(0, 1fr))` }}>
          {quick.map((link) => {
            const active = isActive(link.href, pathname);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-w-0 flex-col items-center justify-center rounded-xl px-1 py-2 text-center text-[11px] font-semibold ${
                  active ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 dark:text-white/70"
                }`}
              >
                <span className="truncate">{link.label === "Billets & ventes" ? "Ventes" : link.label === "Notifications" ? "Alertes" : link.label}</span>
                {link.href === "/inbox" && unread > 0 ? (
                  <span className="mt-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {unread > 99 ? "99+" : unread}
                  </span>
                ) : null}
              </Link>
            );
          })}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className={`rounded-xl px-1 py-2 text-[11px] font-semibold ${open ? "bg-black text-white dark:bg-white dark:text-black" : "text-black/70 dark:text-white/70"}`}
          >
            Menu
          </button>
        </div>
      </nav>
    </>
  );
}
