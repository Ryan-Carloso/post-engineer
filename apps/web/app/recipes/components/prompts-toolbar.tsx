import { cn } from "@/lib/utils";
import { INPUT_CLASS } from "@/lib/ui";

//---------------
// PromptsToolbar — search field plus kind filter chips. Chips
// scroll horizontally on narrow screens instead of wrapping into
// a wall. Presentational: state lives in the page.
//---------------

export interface KindOption<T extends string> {
  value: T;
  label: string;
}

export default function PromptsToolbar<T extends string>({
  query,
  onQueryChange,
  searchLabel,
  searchPlaceholder,
  kinds,
  activeKind,
  onKindChange,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  searchLabel: string;
  searchPlaceholder: string;
  kinds: KindOption<T>[];
  activeKind: T;
  onKindChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <input
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        aria-label={searchLabel}
        placeholder={searchPlaceholder}
        className={cn(INPUT_CLASS, "mt-0 md:max-w-sm")}
      />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0 md:pb-0">
        {kinds.map((kind) => {
          const active = kind.value === activeKind;
          return (
            <button
              key={kind.value}
              type="button"
              aria-pressed={active}
              onClick={() => onKindChange(kind.value)}
              className={cn(
                "shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "border-[#101728] bg-[#101728] text-white"
                  : "border-[#e3e8ef] bg-white text-[#414d63] hover:border-[#101728]",
              )}
            >
              {kind.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
