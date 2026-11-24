export function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured === undefined || configured === '') {
    throw new Error('NEXT_PUBLIC_APP_URL is not defined');
  }
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('NEXT_PUBLIC_APP_URL is not a valid URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('NEXT_PUBLIC_APP_URL must be an http(s) URL');
  }
  return parsed.origin;
}
