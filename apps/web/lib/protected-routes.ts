export const PROTECTED_PREFIXES = [
  '/account',
  '/accounts',
  '/experiments',
  '/metrics',
  '/persona',
  '/personas',
  '/posts',
] as const;

export function isProtectedPath(pathname: string): boolean {
  if (pathname === '/') return true;
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
