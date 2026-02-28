import { AppShell } from "@/components/app-shell";
import { NewsPublisher } from "@/components/news-publisher";
import { prisma } from "@/lib/prisma";
import { requirePageRoles } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const { role } = await requirePageRoles(["ADMIN", "MANAGER", "EMPLOYEE", "ACCOUNTANT"]);

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

  return (
    <AppShell
      role={role}
      accessNote="Page Nouvelles: publications officielles de l'administrateur à destination des équipes."
    >
      <section className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Nouvelles</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Les nouvelles sont publiées par l&apos;administrateur et visibles par les collaborateurs.
        </p>
      </section>

      {role === "ADMIN" ? <NewsPublisher /> : null}

      <div className="space-y-3">
        {news.length > 0 ? news.map((item) => (
          <article key={item.id} className="rounded-2xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-zinc-900">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold">{item.title}</h2>
              <span className="rounded-full border border-black/15 bg-black/5 px-2 py-0.5 text-[10px] font-semibold dark:border-white/20 dark:bg-white/10">
                {item.isPublished ? "Publié" : "Brouillon"}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-black/80 dark:text-white/80">{item.content}</p>
            <p className="mt-2 text-xs text-black/60 dark:text-white/60">
              Par {item.author.name} ({item.author.email}) • {new Date(item.createdAt).toLocaleString()}
            </p>
          </article>
        )) : (
          <p className="rounded-xl border border-dashed border-black/20 px-4 py-5 text-sm text-black/60 dark:border-white/20 dark:text-white/60">
            Aucune nouvelle publiée pour le moment.
          </p>
        )}
      </div>
    </AppShell>
  );
}
