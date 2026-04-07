import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  action?: string;
  user?: string;
  period?: string;
};

function startDateFromPeriod(period?: string) {
  const now = new Date();
  const start = new Date(now);

  if (period === "1h") {
    start.setHours(start.getHours() - 1);
    return start;
  }

  if (period === "30d") {
    start.setDate(start.getDate() - 30);
    return start;
  }

  if (period === "7d") {
    start.setDate(start.getDate() - 7);
    return start;
  }

  start.setDate(start.getDate() - 1);
  return start;
}

function formatActionLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

function extractIpAddress(payload: unknown) {
  if (!payload || typeof payload !== "object") return "Non disponible";

  const ipAddress = (payload as { request?: { ipAddress?: string | null } | null }).request?.ipAddress;
  return typeof ipAddress === "string" && ipAddress.trim() ? ipAddress.trim() : "Non disponible";
}

function formatActionWithDetail(action: string, payload: unknown) {
  const base = formatActionLabel(action);

  if (!payload || typeof payload !== "object") {
    return base;
  }

  const summary = (payload as { summary?: string | null }).summary;
  if (typeof summary === "string" && summary.trim()) {
    return `${base} — ${summary.trim()}`;
  }

  return base;
}

export default async function AdminLogsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { role } = await requirePageModuleAccess("admin", ["ADMIN", "DIRECTEUR_GENERAL"]);
  const params = (await searchParams) ?? {};
  const period = params.period ?? "24h";
  const q = params.q?.trim() ?? "";
  const user = params.user?.trim() ?? "";
  const selectedAction = params.action?.trim() ?? "ALL";
  const rangeStart = startDateFromPeriod(period);

  const filters: Array<Record<string, unknown>> = [
    { createdAt: { gte: rangeStart } },
    {
      action: {
        notIn: ["PAGE_VISIT", "PAGE_FORBIDDEN", "PAGE_ROLE_ACCESS", "API_ACCESS", "API_FORBIDDEN"],
      },
    },
  ];

  if (selectedAction !== "ALL") {
    filters.push({ action: selectedAction });
  }

  if (q) {
    filters.push({
      OR: [
        { action: { contains: q, mode: "insensitive" as const } },
        { entityType: { contains: q, mode: "insensitive" as const } },
        { entityId: { contains: q, mode: "insensitive" as const } },
        { actor: { name: { contains: q, mode: "insensitive" as const } } },
        { actor: { email: { contains: q, mode: "insensitive" as const } } },
      ],
    });
  }

  if (user) {
    filters.push({
      OR: [
        { actor: { name: { contains: user, mode: "insensitive" as const } } },
        { actor: { email: { contains: user, mode: "insensitive" as const } } },
      ],
    });
  }

  const where = { AND: filters };

  const [logs, actions] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        actor: {
          select: {
            name: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.auditLog.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
      take: 100,
    }),
  ]);

  return (
    <AppShell
      role={role}
      accessNote="Journal compact des actions métiers des utilisateurs."
    >
      <section className="mb-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Logs activités utilisateurs</h1>
            <p className="text-sm text-black/60 dark:text-white/60">
              Vue compacte, ligne par ligne, comme un terminal.
            </p>
          </div>
          <Link
            href="/admin"
            className="rounded-md border border-black/20 px-3 py-1.5 text-xs font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            Retour Admin
          </Link>
        </div>
      </section>

      <section className="mb-4 rounded-xl border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-zinc-900">
        <form method="GET" className="grid gap-2 lg:grid-cols-[1.2fr_1fr_1fr_auto]">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Rechercher action, détail ou nom"
            className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          />
          <select
            name="action"
            defaultValue={selectedAction}
            className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          >
            <option value="ALL">Toutes les actions</option>
            {actions.map((item) => (
              <option key={item.action} value={item.action}>{item.action}</option>
            ))}
          </select>
          <select
            name="period"
            defaultValue={period}
            className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          >
            <option value="1h">Dernière heure</option>
            <option value="24h">Dernières 24h</option>
            <option value="7d">7 derniers jours</option>
            <option value="30d">30 derniers jours</option>
          </select>
          <button type="submit" className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">
            Filtrer
          </button>
        </form>
      </section>

      <section className="overflow-hidden rounded-xl border border-black/10 bg-[#050816] text-white dark:border-white/10">
        <div className="border-b border-white/10 px-3 py-2 font-mono text-[11px] uppercase tracking-wide text-white/60">
          <div className="grid gap-3 md:grid-cols-[180px_1.8fr_180px_1fr]">
            <span>Date & heure</span>
            <span>Action + détail</span>
            <span>Adresse IP</span>
            <span>Nom</span>
          </div>
        </div>

        <div className="max-h-[72vh] overflow-y-auto font-mono text-xs">
          {logs.length === 0 ? (
            <p className="px-3 py-6 text-white/60">Aucun log trouvé pour ces filtres.</p>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="border-b border-white/5 px-3 py-2 last:border-b-0">
                <div className="grid gap-3 md:grid-cols-[180px_1.8fr_180px_1fr] md:items-center">
                  <span className="text-white/70">{new Date(log.createdAt).toLocaleString("fr-FR")}</span>
                  <span className="truncate" title={formatActionWithDetail(log.action, log.payload)}>
                    {formatActionWithDetail(log.action, log.payload)}
                  </span>
                  <span className="text-white/70">{extractIpAddress(log.payload)}</span>
                  <span className="truncate">{log.actor.name ?? "Utilisateur inconnu"}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </AppShell>
  );
}
