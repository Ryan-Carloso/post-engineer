export function postUrlFor(slotId: string): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) return null;
  return `${appUrl.replace(/\/+$/, '')}/posts/${slotId}`;
}
