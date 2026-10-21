export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="h-8 w-52 animate-pulse rounded-lg bg-black/10 dark:bg-white/10" />
      <div className="h-28 animate-pulse rounded-2xl bg-black/5 dark:bg-white/10" />
      <div className="h-64 animate-pulse rounded-2xl bg-black/5 dark:bg-white/10" />
    </div>
  );
}
