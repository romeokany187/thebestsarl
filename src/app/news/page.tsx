import { AppShell } from "@/components/app-shell";
import { NewsPublisher } from "@/components/news-publisher";
import { prisma } from "@/lib/prisma";
import { requirePageModuleAccess } from "@/lib/rbac";

export const dynamic = "force-dynamic";

type NewsCategory = "ALERTE" | "FINANCE" | "RH" | "OPERATIONS" | "GENERAL";

function getNewsCategory(title: string, content: string): NewsCategory {
  const source = `${title} ${content}`.toLowerCase();

  if (/alerte|urgent|incident|attention|retard|panne/.test(source)) return "ALERTE";
  if (/caisse|paiement|facture|finance|comptable|budget/.test(source)) return "FINANCE";
  if (/rh|ressource humaine|conge|absence|recrutement|personnel/.test(source)) return "RH";
  if (/stock|approvisionnement|operation|terrain|logistique|service/.test(source)) return "OPERATIONS";
  return "GENERAL";
}

function categoryMeta(category: NewsCategory) {
  if (category === "ALERTE") return { label: "Alerte", tone: "bg-red-50 text-red-700 border-red-200", icon: "AV" };
  if (category === "FINANCE") return { label: "Finance", tone: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: "FN" };
  if (category === "RH") return { label: "RH", tone: "bg-amber-50 text-amber-700 border-amber-200", icon: "RH" };
  if (category === "OPERATIONS") return { label: "Opérations", tone: "bg-blue-50 text-blue-700 border-blue-200", icon: "OP" };
  return { label: "Général", tone: "bg-slate-50 text-slate-700 border-slate-200", icon: "CM" };
}

export default async function NewsPage() {
  const { role } = await requirePageModuleAccess("news", ["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);

  const news = await prisma.newsPost.findMany({
    where: role === "ADMIN" ? {} : { isPublished: true },
    include: {
      author: {
        select: { name: true, email: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 80,
  });

  const grouped = new Map<NewsCategory, typeof news>();

  for (const item of news) {
    const category = getNewsCategory(item.title, item.content);
    const current = grouped.get(category) ?? [];
    current.push(item);
    grouped.set(category, current);
  }

  const orderedCategories: NewsCategory[] = ["ALERTE", "FINANCE", "RH", "OPERATIONS", "GENERAL"];

  return (
    <AppShell
      role={role}
      accessNote={role === "ADMIN"
        ? "Pilotage éditorial: vous pouvez publier les nouvelles officielles de la direction."
        : "Mode lecture: consultation des nouvelles publiées par la direction."}
    >
      <section className="mb-6 rounded-3xl border border-black/10 bg-linear-to-br from-white via-slate-50 to-blue-50 p-5 shadow-sm dark:border-white/10 dark:from-zinc-900 dark:via-zinc-900 dark:to-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-black/55 dark:text-white/55">Communication interne</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Nouvelles</h1>
            <p className="mt-1 text-sm text-black/65 dark:text-white/65">
              Publications officielles de la Direction Générale.
            </p>
          </div>
          <div className="rounded-full border border-black/15 bg-white/70 px-3 py-1 text-xs font-semibold dark:border-white/20 dark:bg-zinc-800/70">
            {role === "ADMIN" ? "Mode édition" : "Mode lecture"}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr,340px]">
        <section className="space-y-4">
          {orderedCategories.map((category) => {
            const items = grouped.get(category) ?? [];
            if (items.length === 0) return null;

            const meta = categoryMeta(category);

            return (
              <section key={category} className="rounded-2xl border border-black/10 bg-white p-3.5 shadow-sm dark:border-white/10 dark:bg-zinc-900">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-1.5 text-[10px] font-bold ${meta.tone}`}>
                      {meta.icon}
                    </span>
                    <h3 className="text-sm font-semibold">{meta.label}</h3>
                  </div>
                  <span className="text-xs text-black/55 dark:text-white/55">{items.length} publication(s)</span>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((item) => (
                    <article key={item.id} className="rounded-xl border border-black/10 bg-black/2 p-2.5 dark:border-white/10 dark:bg-white/3">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-1.5 text-[10px] font-bold ${meta.tone}`}>
                          {meta.icon}
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
            );
          })}

          {news.length === 0 ? (
            <p className="rounded-xl border border-dashed border-black/20 px-4 py-5 text-sm text-black/60 dark:border-white/20 dark:text-white/60">
              Aucune nouvelle publiée pour le moment.
            </p>
          ) : null}
        </section>

        <aside className="space-y-4">
          {role === "ADMIN" ? <NewsPublisher /> : null}
          <section className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold">Règles d'accès</h2>
            <p className="mt-2 text-xs text-black/65 dark:text-white/65">
              Lecture: tous les profils autorisés.
            </p>
            <p className="mt-1 text-xs text-black/65 dark:text-white/65">
              Rédaction/publication: administrateur uniquement.
            </p>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
