import { cn } from '@/lib/utils';

export type ThemeChoice = 'light' | 'dark' | 'system';

export interface ThemeToggleLabels {
  group: string;
  light: string;
  dark: string;
  system: string;
}

interface ThemeToggleProps {
  value: ThemeChoice;
  onChange: (value: ThemeChoice) => void;
  labels: ThemeToggleLabels;
  // Disabled until the stored theme is known on the client, so the pressed
  // state never flashes the wrong option during hydration.
  disabled?: boolean;
  className?: string;
}

const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const SunIcon = () => (
  <svg {...ICON_PROPS}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

const MoonIcon = () => (
  <svg {...ICON_PROPS}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);

const MonitorIcon = () => (
  <svg {...ICON_PROPS}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);

const OPTIONS: ReadonlyArray<{ value: ThemeChoice; icon: () => React.JSX.Element }> = [
  { value: 'light', icon: SunIcon },
  { value: 'dark', icon: MoonIcon },
  { value: 'system', icon: MonitorIcon },
];

// Presentational light / dark / system segmented control. State, storage and
// the DOM class live in ThemeSwitcher (next-themes); this only renders.
export function ThemeToggle({ value, onChange, labels, disabled = false, className }: ThemeToggleProps) {
  return (
    <div
      role="group"
      aria-label={labels.group}
      className={cn('flex items-center justify-center gap-1 rounded-xl border border-hairline bg-surface p-1', className)}
    >
      {OPTIONS.map(({ value: option, icon: Icon }) => {
        const isActive = option === value;
        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            aria-pressed={isActive}
            aria-label={labels[option]}
            title={labels[option]}
            onClick={() => onChange(option)}
            className={cn(
              'flex min-h-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-60 md:flex-none md:px-3',
              isActive ? 'bg-card text-ink shadow-sm' : 'text-muted-text hover:bg-card hover:text-ink',
            )}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}
