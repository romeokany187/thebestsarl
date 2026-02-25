import { AppShell } from "@/components/app-shell";
import { AttendanceForm } from "@/components/attendance-form";
import { prisma } from "@/lib/prisma";
import { requirePageRoles } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function AttendancePage() {
  const { session, role } = await requirePageRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);
  const canManageAttendance = role === "ADMIN" || role === "MANAGER" || role === "EMPLOYEE";
  const accessNote = canManageAttendance
    ? role === "EMPLOYEE"
      ? "Accès personnel: vous pouvez saisir et consulter uniquement vos présences."
      : "Accès gestion: vous pouvez saisir et suivre les présences de l'équipe."
    : "Accès lecture seule: consultation des présences uniquement.";

  const [users, records] = await Promise.all([
    prisma.user.findMany({
      where: role === "EMPLOYEE" ? { id: session.user.id } : undefined,
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.attendance.findMany({
      where: role === "EMPLOYEE" ? { userId: session.user.id } : undefined,
      include: {
        user: { select: { name: true } },
        matchedSite: { select: { name: true, type: true } },
      },
      orderBy: { date: "desc" },
      take: 50,
    }),
  ]);

  return (
    <AppShell role={role} accessNote={accessNote}>
      <section className="mb-6">
        <h1 className="text-2xl font-semibold">Gestion des présences</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Pointage, retards, heures supplémentaires et suivi quotidien des équipes.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-[380px,1fr]">
        {canManageAttendance ? (
          <AttendanceForm users={users} />
        ) : (
          <section className="rounded-xl border border-black/10 bg-white p-4 text-sm text-black/70 dark:border-white/10 dark:bg-zinc-900 dark:text-white/70">
            Accès en lecture seule: vous pouvez consulter les présences mais pas les modifier.
          </section>
        )}

        <div className="overflow-hidden rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
          <table className="min-w-full text-sm">
            <thead className="bg-black/5 dark:bg-white/10">
              <tr>
                <th className="px-3 py-2 text-left">Employé</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Entrée</th>
                <th className="px-3 py-2 text-left">Sortie</th>
                <th className="px-3 py-2 text-left">Signé à</th>
                <th className="px-3 py-2 text-left">Localisation détectée</th>
                <th className="px-3 py-2 text-left">Retard</th>
                <th className="px-3 py-2 text-left">Heures supp.</th>
              </tr>
            </thead>
            <tbody>
              {records.map((row) => (
                <tr key={row.id} className="border-t border-black/5 dark:border-white/10">
                  <td className="px-3 py-2">{row.user.name}</td>
                  <td className="px-3 py-2">{new Date(row.date).toLocaleDateString()}</td>
                  <td className="px-3 py-2">{row.clockIn ? new Date(row.clockIn).toLocaleTimeString() : "-"}</td>
                  <td className="px-3 py-2">{row.clockOut ? new Date(row.clockOut).toLocaleTimeString() : "-"}</td>
                  <td className="px-3 py-2">{row.signedAt ? new Date(row.signedAt).toLocaleString() : "-"}</td>
                  <td className="px-3 py-2">
                    {row.locationStatus}
                    {row.matchedSite ? ` (${row.matchedSite.name})` : ""}
                    {row.signLatitude && row.signLongitude
                      ? ` • ${row.signLatitude.toFixed(5)}, ${row.signLongitude.toFixed(5)}`
                      : ""}
                  </td>
                  <td className="px-3 py-2">{row.latenessMins} min</td>
                  <td className="px-3 py-2">{row.overtimeMins} min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
