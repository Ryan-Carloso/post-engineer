'use client';

import { SECTION_LABEL_CLASS } from '@/lib/ui';

//---------------
// SectionDivider — divider with label
//---------------
export function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={SECTION_LABEL_CLASS}>{label}</span>
      <span className="h-px flex-1 bg-neutral-200" />
    </div>
  );
}

//---------------
// InlineFieldError — validation error next to the invalid field.
//---------------
export function InlineFieldError({ message }: { message: string }) {
  return (
    <p role="alert" className="mt-2 text-sm font-medium text-red-700">{message}</p>
  );
}