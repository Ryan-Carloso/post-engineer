import { forwardRef } from 'react';
import type { LucideProps } from 'lucide-react';

// Partial-ring progress glyph for calendar markers and legend (not a
// letter-like loader).
export const CalendarProgressIcon = forwardRef<SVGSVGElement, LucideProps>(function CalendarProgressIcon(
  { className, strokeWidth: _strokeWidth, ...rest },
  ref,
) {
  return (
    <svg ref={ref} viewBox="0 0 24 24" className={className} fill="none" {...rest}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.35" />
      <path
        d="M12 3a9 9 0 0 1 7.794 4.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
});
