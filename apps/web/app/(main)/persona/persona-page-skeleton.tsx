//---------------
// PersonaPageSkeleton — loading placeholder for the persona screen.
// Extracted from page.tsx (issue #572): the page is grandfathered over
// the 500-line file-size cap and may not grow, so the create-mode binding
// picker is offset by moving this block into its own module.
//---------------
export const PersonaPageSkeleton = () => (
  <div aria-busy="true" aria-live="polite" className="space-y-8">
    <div className="flex items-center gap-3">
      <div className="skeleton-shimmer size-10 shrink-0 rounded-xl" />
      <div className="space-y-2">
        <div className="skeleton-shimmer h-5 w-40 rounded" />
        <div className="skeleton-shimmer h-3.5 w-64 rounded" />
      </div>
    </div>
    <section className="space-y-6 rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6">
      <div className="flex gap-2"><div className="skeleton-shimmer h-9 w-28 rounded-lg" /><div className="skeleton-shimmer h-9 w-24 rounded-lg" /></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="skeleton-shimmer aspect-square rounded-xl" /><div className="skeleton-shimmer aspect-square rounded-xl" /><div className="skeleton-shimmer aspect-square rounded-xl" /><div className="skeleton-shimmer aspect-square rounded-xl" /></div>
      <div className="space-y-2"><div className="skeleton-shimmer h-4 w-28 rounded" /><div className="skeleton-shimmer h-12 w-full rounded-xl" /></div>
    </section>
    <section className="space-y-4 rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6">
      <div className="skeleton-shimmer h-4 w-32 rounded" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="skeleton-shimmer h-16 rounded-xl" /><div className="skeleton-shimmer h-16 rounded-xl" /><div className="skeleton-shimmer h-16 rounded-xl" /></div>
    </section>
    <section className="space-y-6 rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6">
      <div className="skeleton-shimmer h-4 w-36 rounded" />
      <div className="skeleton-shimmer h-12 w-full rounded-xl" />
      <div className="skeleton-shimmer h-24 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-3"><div className="skeleton-shimmer h-12 rounded-xl" /><div className="skeleton-shimmer h-12 rounded-xl" /><div className="skeleton-shimmer h-12 rounded-xl" /></div>
    </section>
    <div className="skeleton-shimmer h-12 w-full rounded-xl" />
  </div>
);
