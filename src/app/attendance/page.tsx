import { AppShell } from "@/components/app-shell";
import { AttendanceForm } from "@/components/attendance-form";
import { AttendanceRecordsTable } from "@/components/attendance-records-table";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type SearchParams = {
  startDate?: string;
  endDate?: string;
  userId?: string;
};

function dateRangeFromParams(params: SearchParams) {
  const now = new Date();
  const defaultDay = now.toISOString().slice(0, 10);
  const startRaw = params.startDate ?? defaultDay;
  const endRaw = params.endDate ?? startRaw;
  const start = new Date(`${startRaw}T00:00:00.000Z`);
  const end = new Date(`${endRaw}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  return {
    start,
    end,
    startRaw,
    endRaw,
    label: `Période du ${startRaw} au ${endRaw}`,
  };
}

export default async function AttendancePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { session, role } = await requirePageModuleAccess("attendance", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const resolvedSearchParams = (await searchParams) ?? {};
  const range = dateRangeFromParams(resolvedSearchParams);
  const canManageAttendance = role !== "ADMIN";
  const selectedUserId = role === "ADMIN"
    ? resolvedSearchParams.userId && resolvedSearchParams.userId !== "ALL"
      ? resolvedSearchParams.userId
      : undefined
    : session.user.id;
  const accessNote = canManageAttendance
    ? "Accès personnel: vous signez votre présence et consultez uniquement vos propres lignes."
    : "Accès lecture seule: consultation des présences uniquement.";

  const users = role !== "ADMIN"
    ? []
    : await prisma.user.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 300,
    });

  const reportQuery = new URLSearchParams({
    startDate: range.startRaw,
    endDate: range.endRaw,
    ...(selectedUserId ? { userId: selectedUserId } : {}),
  }).toString();

  const records = await prisma.attendance.findMany({
    where: {
      date: { gte: range.start, lt: range.end },
      ...(selectedUserId ? { userId: selectedUserId } : {}),
    },
    include: {
      user: { select: { name: true } },
      matchedSite: { select: { name: true, type: true } },
    },
    orderBy: { date: "desc" },
    take: 300,
  });

  return (
    <AppShell role={role} accessNote={accessNote}>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold">Gestion des présences</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Pointage, retards, heures supplémentaires et suivi quotidien des équipes.
        </p>
      </section>

      <section className="mb-6 rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900">
        <form method="GET" className="grid gap-3 lg:grid-cols-4 lg:items-end">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Du</label>
            <input
              type="date"
              name="startDate"
              defaultValue={range.startRaw}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Au</label>
            <input
              type="date"
              name="endDate"
              defaultValue={range.endRaw}
              className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </div>
          {role === "ADMIN" ? (
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">Employé</label>
              <select
                name="userId"
                defaultValue={resolvedSearchParams.userId ?? "ALL"}
                className="w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
              >
                <option value="ALL">Tous les employés</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.name}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="text-xs text-black/60 dark:text-white/60">Vue personnelle uniquement.</div>
          )}
          <button type="submit" className="rounded-md bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-white dark:text-black">
            Filtrer
          </button>
        </form>
        {role === "ADMIN" ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <a
              href={`/api/attendance/report?${reportQuery}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex rounded-md border border-black/20 px-2.5 py-1 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Lire rapport PDF
            </a>
            <a
              href={`/api/attendance/report?${reportQuery}&download=1`}
              className="inline-flex rounded-md border border-black/20 px-2.5 py-1 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
            >
              Télécharger rapport PDF
            </a>
          </div>
        ) : null}
        <p className="mt-2 text-xs text-black/60 dark:text-white/60">{range.label}</p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[380px,1fr]">
        {canManageAttendance ? (
          <AttendanceForm role={role} />
        ) : (
          <section className="rounded-xl border border-black/10 bg-white p-4 text-sm text-black/70 dark:border-white/10 dark:bg-zinc-900 dark:text-white/70">
            Accès en lecture seule: vous pouvez consulter les présences mais pas les modifier.
          </section>
        )}

        <AttendanceRecordsTable
          initialRecords={records}
          startDate={range.startRaw}
          endDate={range.endRaw}
          userId={selectedUserId}
          showEmployeeColumn={role === "ADMIN"}
        />
      </div>
    </AppShell>
  );
}
