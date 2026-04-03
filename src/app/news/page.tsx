import { AppShell } from "@/components/app-shell";
import { NewsPublisher } from "@/components/news-publisher";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  const { role } = await requirePageModuleAccess("news", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);

  const canPublishNews = role === "ADMIN" || role === "DIRECTEUR_GENERAL";

  const news = await prisma.newsPost.findMany({
    where: canPublishNews ? {} : { isPublished: true },
    include: {
      author: {
        select: { name: true, email: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 80,
  });

  return (
    <AppShell
      role={role}
      accessNote={role === "ADMIN" || role === "DIRECTEUR_GENERAL"
        ? "Pilotage éditorial: vous pouvez publier les nouvelles officielles de la direction."
        : "Mode lecture: consultation des nouvelles publiées par la direction."}
    >
      <section className="mb-6 rounded-3xl border border-black/10 bg-linear-to-br from-white via-slate-50 to-blue-50 p-5 shadow-sm dark:border-white/10 dark:from-zinc-900 dark:via-zinc-900 dark:to-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-black/55 dark:text-white/55">Communication interne</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Nouvelles</h1>
            <p className="mt-1 text-sm text-black/65 dark:text-white/65">
              Publications officielles du Directeur Général.
            </p>
          </div>
          <div className="rounded-full border border-black/15 bg-white/70 px-3 py-1 text-xs font-semibold dark:border-white/20 dark:bg-zinc-800/70">
            {canPublishNews ? "Mode édition" : "Mode lecture"}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr,340px]">
        <section className="space-y-4">
          {news.length > 0 ? (
            <section className="rounded-2xl border border-black/10 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Tous les communiqués</h3>
                <span className="text-xs text-black/55 dark:text-white/55">{news.length} publication(s)</span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {news.map((item) => (
                  <article key={item.id} className="rounded-xl border border-black/10 bg-black/2 p-2.5 dark:border-white/10 dark:bg-white/3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-black/20 bg-slate-50 px-1.5 text-[10px] font-bold text-slate-700 dark:border-white/20 dark:bg-zinc-800 dark:text-zinc-200">
                        CM
                      </span>
                      <a
                        href={`/api/news/${item.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded-md border border-black/15 px-2 py-0.5 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                      >
                        Lire
                      </a>
                    </div>
                    <h4 className="mt-2 line-clamp-2 text-sm font-semibold leading-snug">{item.title}</h4>
                    <p className="mt-1 text-[11px] text-black/55 dark:text-white/55">{new Date(item.createdAt).toLocaleDateString("fr-FR")}</p>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {news.length === 0 ? (
            <p className="rounded-xl border border-dashed border-black/20 px-4 py-5 text-sm text-black/60 dark:border-white/20 dark:text-white/60">
              Aucune nouvelle publiée pour le moment.
            </p>
          ) : null}
        </section>

        <aside className="space-y-4">
          {canPublishNews ? <NewsPublisher /> : null}
          <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold">Règles d&apos;accès</h2>
            <p className="mt-2 text-xs text-black/65 dark:text-white/65">
              Lecture: tous les profils autorisés.
            </p>
            <p className="mt-1 text-xs text-black/65 dark:text-white/65">
              Rédaction/publication: administrateur et Directeur Général.
            </p>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
