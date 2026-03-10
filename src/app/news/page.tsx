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
  if (category === "ALERTE") return { label: "Alerte", tone: "bg-red-50 text-red-700 border-red-200", icon: "!" };
  if (category === "FINANCE") return { label: "Finance", tone: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: "$" };
  if (category === "RH") return { label: "RH", tone: "bg-amber-50 text-amber-700 border-amber-200", icon: "RH" };
  if (category === "OPERATIONS") return { label: "Opérations", tone: "bg-blue-50 text-blue-700 border-blue-200", icon: "OP" };
  return { label: "Général", tone: "bg-slate-50 text-slate-700 border-slate-200", icon: "N" };
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

  const [featured, ...others] = news;
  const grouped = new Map<NewsCategory, typeof others>();

  for (const item of others) {
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
          {featured ? (
            <article className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-black/55 dark:text-white/55">A la une</p>
              <h2 className="mt-1 text-lg font-semibold leading-tight">{featured.title}</h2>
              <p className="mt-2 line-clamp-5 whitespace-pre-wrap text-sm leading-relaxed text-black/80 dark:text-white/80">{featured.content}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/10 pt-2 text-xs text-black/60 dark:border-white/10 dark:text-white/60">
                <p>Par {featured.author.name} ({featured.author.email}) • {new Date(featured.createdAt).toLocaleString("fr-FR")}</p>
                <a
                  href={`/api/news/${featured.id}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-black/15 px-2.5 py-1 font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                >
                  Lire PDF
                </a>
              </div>
            </article>
          ) : null}

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

                <div className="divide-y divide-black/10 dark:divide-white/10">
                  {items.map((item) => (
                    <article key={item.id} className="py-2 first:pt-0 last:pb-0">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-sm font-semibold leading-snug">{item.title}</h4>
                        <a
                          href={`/api/news/${item.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 rounded-md border border-black/15 px-2 py-0.5 text-[11px] font-semibold hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                        >
                          PDF
                        </a>
                      </div>
                      <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-black/75 dark:text-white/75">{item.content}</p>
                      <p className="mt-1 text-[11px] text-black/55 dark:text-white/55">{new Date(item.createdAt).toLocaleString("fr-FR")} • {item.author.name}</p>
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
