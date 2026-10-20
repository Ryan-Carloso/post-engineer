'use client';

import Image from 'next/image';
import { useState } from 'react';
import { twMerge } from 'tailwind-merge';

//---------------
// AppLogo — the Post Engineer brand mark. Single source for the logo
// everywhere (sidebar, landing, login): one PNG in /public. `size` sets
// width/height in px. Callers may override the radius via className —
// twMerge keeps the caller's radius instead of the base one (Tailwind
// resolves conflicting utilities by stylesheet order, not attribute order).
// No `priority`: these are small brand marks, never LCP candidates.
// On load failure, renders an initials tile so the UI never shows the
// browser broken-image glyph.
//---------------
export default function AppLogo({
  size = 40,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        role="img"
        aria-label="Post Engineer"
        data-testid="app-logo-fallback"
        style={{ width: size, height: size }}
        className={twMerge(
          'flex shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-[#ff544c] to-[#ff8a85] text-xs font-bold text-white',
          className,
        )}
      >
        PE
      </div>
    );
  }

  return (
    <Image
      src="/logo.png"
      alt="Post Engineer"
      width={size}
      height={size}
      className={twMerge('shrink-0 rounded-2xl', className)}
      data-testid="app-logo"
      onError={() => {
        setFailed(true);
      }}
    />
  );
}
