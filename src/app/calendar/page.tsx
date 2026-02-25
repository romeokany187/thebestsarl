import { AppShell } from "@/components/app-shell";
import { requirePageRoles } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const weekDays = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const agenda = [
  { day: "Lun", title: "Briefing commercial", time: "09:00" },
  { day: "Mar", title: "Validation rapports hebdo", time: "11:00" },
  { day: "Mer", title: "Suivi paiements en retard", time: "14:30" },
  { day: "Jeu", title: "Point équipes opérations", time: "10:00" },
  { day: "Ven", title: "Revue KPI direction", time: "16:00" },
];

export default async function CalendarPage() {
  const { role } = await requirePageRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);

  return (
    <AppShell role={role} accessNote="Calendrier partagé: planning hebdomadaire des activités et rituels de pilotage.">
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Calendrier</h1>
        <p className="text-sm text-black/60 dark:text-white/60">Planification des tâches et réunions clés de la semaine.</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-[2fr,1fr]">
        <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold">Vue hebdomadaire</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
            {weekDays.map((day) => (
              <article key={day} className="min-h-32 rounded-xl border border-black/10 bg-background p-3 dark:border-white/10">
                <p className="text-xs font-semibold uppercase tracking-wide text-black/60 dark:text-white/60">{day}</p>
                <div className="mt-3 space-y-2">
                  {agenda
                    .filter((item) => item.day === day)
                    .map((item) => (
                      <p key={item.title} className="rounded-lg bg-white px-2 py-1 text-xs font-medium shadow-sm dark:bg-zinc-900">
                        {item.time} • {item.title}
                      </p>
                    ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
          <h2 className="mb-4 text-lg font-semibold">Agenda prioritaire</h2>
          <ul className="space-y-3 text-sm">
            {agenda.map((item) => (
              <li key={item.title} className="rounded-xl border border-black/10 px-3 py-3 dark:border-white/10">
                <p className="font-medium">{item.title}</p>
                <p className="text-xs text-black/60 dark:text-white/60">{item.day} • {item.time}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
