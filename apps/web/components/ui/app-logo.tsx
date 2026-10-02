import Image from 'next/image';
import { twMerge } from 'tailwind-merge';

//---------------
// AppLogo — the Post Engineer brand mark. Single source for the logo
// everywhere (sidebar, landing, login): one PNG in /public. `size` sets
// width/height in px. Callers may override the radius via className —
// twMerge keeps the caller's radius instead of the base one (Tailwind
// resolves conflicting utilities by stylesheet order, not attribute order).
// No `priority`: these are small brand marks, never LCP candidates.
//---------------
export default function AppLogo({
  size = 40,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src="/logo.png"
      alt="Post Engineer"
      width={size}
      height={size}
      className={twMerge('shrink-0 rounded-2xl', className)}
      data-testid="app-logo"
    />
  );
}
