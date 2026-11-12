//---------------
// post-url — the one place that builds the absolute post detail link
// (issue #555). The agent sends this link in chat so the owner can watch
// / download the video and edit / reschedule / delete the post from its
// detail page. Every surface that returns a slot (post detail, schedule
// status, video status) builds it through here so the path never drifts.
// The link is built from the configured public base URL
// (NEXT_PUBLIC_APP_URL), never from the request origin: behind the Caddy
// proxy the request reaches Next with Host 0.0.0.0:3000, so an
// origin-built link is dead for every agent. Null when the base URL is
// not configured — every caller already renders a null postUrl.
//---------------
export function postUrlFor(slotId: string): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) return null;
  return `${appUrl.replace(/\/+$/, '')}/posts/${slotId}`;
}
