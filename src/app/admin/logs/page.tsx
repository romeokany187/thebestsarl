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

function actionTone(value: string) {
  if (value.includes("FORBIDDEN") || value.includes("REJECT")) {
    return "border-red-300 bg-red-50 text-red-700 dark:border-red-700/50 dark:bg-red-950/30 dark:text-red-300";
  }

  if (value.includes("VISIT") || value.includes("ACCESS")) {
    return "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-700/50 dark:bg-sky-950/30 dark:text-sky-300";
  }

  if (value.includes("EXECUTED") || value.includes("APPROVED") || value.includes("CREATE") || value.includes("CREDIT")) {
    return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700/50 dark:bg-emerald-950/30 dark:text-emerald-300";
  }

  return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700/50 dark:bg-amber-950/30 dark:text-amber-300";
}

function summarizePayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return "Aucun détail complémentaire.";

  const record = payload as {
    details?: {
      module?: string | null;
      role?: string | null;
      jobTitle?: string | null;
      allowedRoles?: string[];
      fileName?: string | null;
      summary?: { period?: string | null };
    } | null;
    request?: { referer?: string | null; pathHint?: string | null; host?: string | null } | null;
  };

  const chips: string[] = [];

  if (record.details?.module) chips.push(`module ${record.details.module}`);
  if (record.details?.role) chips.push(`rôle ${record.details.role}`);
  if (record.details?.jobTitle) chips.push(`fonction ${record.details.jobTitle}`);
  if (record.details?.fileName) chips.push(`fichier ${record.details.fileName}`);
  if (record.details?.summary?.period) chips.push(`période ${record.details.summary.period}`);
  if (record.request?.pathHint) chips.push(`route ${record.request.pathHint}`);
  if (record.request?.referer) chips.push(`source ${record.request.referer}`);
  if (record.request?.host) chips.push(`host ${record.request.host}`);

  return chips.length > 0 ? chips.slice(0, 3).join(" • ") : "Action authentifiée enregistrée.";
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

  const [logs, actions, totalInRange, forbiddenCount, pageVisitCount, apiAccessCount, activeUsers] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        actor: {
          select: {
            name: true,
            email: true,
            role: true,
            jobTitle: true,
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
    prisma.auditLog.count({ where: { createdAt: { gte: rangeStart } } }),
    prisma.auditLog.count({ where: { createdAt: { gte: rangeStart }, action: { contains: "FORBIDDEN" } } }),
    prisma.auditLog.count({ where: { createdAt: { gte: rangeStart }, action: "PAGE_VISIT" } }),
    prisma.auditLog.count({ where: { createdAt: { gte: rangeStart }, action: { in: ["API_ACCESS", "API_FORBIDDEN"] } } }),
    prisma.auditLog.findMany({
      where: { createdAt: { gte: rangeStart } },
      distinct: ["actorId"],
      select: { actorId: true },
    }).then((rows) => rows.length),
  ]);

  const lastLogAt = logs[0]?.createdAt ? new Date(logs[0].createdAt).toLocaleString("fr-FR") : "-";

  return (
    <AppShell
      role={role}
      accessNote="Journal centralisé des actions des utilisateurs: accès pages, appels API protégés et opérations critiques historisés."
    >
      <section className="mb-6 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Logs activités utilisateurs</h1>
            <p className="text-sm text-black/60 dark:text-white/60">
              Vue de supervision inspirée des runtime logs: toutes les actions authentifiées importantes sont centralisées ici.
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

      <section className="mb-6 rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <form method="GET" className="grid gap-3 xl:grid-cols-4">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Rechercher action, utilisateur, entité..."
            className="rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
          />
          <input
            type="text"
            name="user"
            defaultValue={user}
            placeholder="Filtrer par utilisateur / email"
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
          <div className="flex gap-2">
            <select
              name="period"
              defaultValue={period}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            >
              <option value="1h">Dernière heure</option>
              <option value="24h">Dernières 24h</option>
              <option value="7d">7 derniers jours</option>
              <option value="30d">30 derniers jours</option>
            </select>
            <button type="submit" className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">
              Filtrer
            </button>
          </div>
        </form>
      </section>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <p className="text-xs uppercase tracking-wide text-black/55 dark:text-white/55">Volume des logs</p>
          <p className="mt-2 text-2xl font-semibold">{totalInRange}</p>
        </div>
        <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <p className="text-xs uppercase tracking-wide text-black/55 dark:text-white/55">Utilisateurs actifs</p>
          <p className="mt-2 text-2xl font-semibold">{activeUsers}</p>
        </div>
        <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <p className="text-xs uppercase tracking-wide text-black/55 dark:text-white/55">Visites pages</p>
          <p className="mt-2 text-2xl font-semibold">{pageVisitCount}</p>
        </div>
        <div className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <p className="text-xs uppercase tracking-wide text-black/55 dark:text-white/55">Alertes accès refusés</p>
          <p className="mt-2 text-2xl font-semibold">{forbiddenCount}</p>
          <p className="mt-1 text-xs text-black/55 dark:text-white/55">API protégées: {apiAccessCount}</p>
        </div>
      </div>

      <section className="rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-black/10 px-4 py-3 dark:border-white/10">
          <div>
            <h2 className="text-base font-semibold">Journal des événements</h2>
            <p className="text-xs text-black/55 dark:text-white/55">Dernière entrée visible: {lastLogAt}</p>
          </div>
          <span className="rounded-full border border-black/15 px-3 py-1 text-[11px] font-semibold dark:border-white/20">
            {logs.length} entrée(s) affichée(s)
          </span>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-3">
          {logs.length === 0 ? (
            <p className="py-8 text-center text-sm text-black/55 dark:text-white/55">
              Aucun log trouvé pour ces filtres.
            </p>
          ) : (
            <div className="space-y-2 font-mono text-xs">
              {logs.map((log) => (
                <article key={log.id} className="rounded-xl border border-black/10 px-3 py-3 dark:border-white/10">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-black/55 dark:text-white/55">{new Date(log.createdAt).toLocaleString("fr-FR")}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${actionTone(log.action)}`}>
                          {formatActionLabel(log.action)}
                        </span>
                        <span className="rounded-full border border-black/10 px-2 py-0.5 text-[10px] dark:border-white/10">
                          {log.entityType}:{log.entityId}
                        </span>
                      </div>

                      <p className="mt-2 text-sm font-semibold not-italic">
                        {log.actor.name} <span className="font-normal text-black/60 dark:text-white/60">({log.actor.email})</span>
                      </p>
                      <p className="mt-1 not-italic text-black/70 dark:text-white/70">
                        {log.actor.role} • {log.actor.jobTitle}
                      </p>
                      <p className="mt-1 not-italic text-black/65 dark:text-white/65">
                        {summarizePayload(log.payload)}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    </AppShell>
  );
}
