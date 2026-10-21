import Link from "next/link";
import type { HomeQuickAction } from "@/lib/workspace-home";

export function WorkspaceHome({
  title,
  actions,
}: {
  title: string;
  actions: HomeQuickAction[];
}) {
  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Ouvrez un écran. Le menu indique où vous êtes et regroupe les modules par métier.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group rounded-2xl border border-black/10 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-black/20 hover:shadow-md dark:border-white/10 dark:bg-zinc-900 dark:hover:border-white/20"
          >
            <p className="text-base font-semibold group-hover:underline">{action.label}</p>
            <p className="mt-2 text-sm text-black/60 dark:text-white/60">{action.description}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
