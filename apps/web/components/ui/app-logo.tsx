import Image from 'next/image';

//---------------
// AppLogo — the Post Engineer brand mark. Single source for the logo
// everywhere (sidebar, landing, login): one PNG in /public, rounded to
// match the app's card radius. `size` sets width/height in px.
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
      className={`shrink-0 rounded-2xl ${className}`}
      data-testid="app-logo"
      priority
    />
  );
}
