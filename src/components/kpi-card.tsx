export function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-zinc-900">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-black/55 dark:text-white/55">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight sm:text-[28px]">{value}</p>
      {hint ? <p className="mt-1 text-xs text-black/60 dark:text-white/60">{hint}</p> : null}
    </div>
  );
}
