const SHIMMER = 'skeleton-shimmer';

const CARD_COUNT = 6;

export function PageLoadingSkeleton(): React.JSX.Element {
  return (
    <div aria-busy="true" aria-live="polite" data-page-loading-skeleton className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="space-y-2">
          <div className={`${SHIMMER} h-7 w-48 rounded`} />
          <div className={`${SHIMMER} h-4 w-72 max-w-full rounded`} />
        </div>
        <div className={`${SHIMMER} h-10 w-32 rounded-lg`} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: CARD_COUNT }, (_, index) => (
          <div key={`card-${index}`} data-skeleton-card className={`${SHIMMER} h-36 rounded-2xl`} />
        ))}
      </div>
    </div>
  );
}
