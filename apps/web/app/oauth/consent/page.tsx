import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getOAuthKeys } from '@/lib/oauth/keys';
import { verifyConsentRequest } from '@/lib/oauth/tokens';
import { resolveClient } from '@/lib/oauth/resolve-client';
import { sanitizeClientName } from '@/lib/oauth/client-name';

//---------------
// /oauth/consent — OAuth consent screen. Receives the signed request
// (?request=...), requires the owner's session, and approves/denies via
// POST to /oauth/approve. Without a session (or a different owner) → /login
// with `next` to resume exactly here after login.
//---------------

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const { request: token } = await searchParams;
  const resume = `/oauth/consent?request=${encodeURIComponent(token ?? '')}`;

  const keys = await getOAuthKeys().catch(() => null);
  const claims = token && keys ? await verifyConsentRequest(keys, token).catch(() => null) : null;
  if (!claims) {
    redirect('/landing');
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== claims.sub) {
    redirect(`/login?next=${encodeURIComponent(resume)}`);
  }

  const service = createSupabaseServiceClient();
  const client = await resolveClient(claims.clientId, service);
  const scopes = claims.scope.split(' ').filter((scope) => scope.length > 0);
  // Hardened display name: Unicode-normalized, no bidi/control characters,
  // length-capped — a client name must not be able to visually impersonate
  // another application on the consent screen.
  const displayName = sanitizeClientName(client?.clientName, 'o aplicativo');

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-5 py-12">
      <div className="w-full max-w-md rounded-3xl border border-hairline bg-card p-8 shadow-[0_20px_60px_rgba(20,32,51,0.08)] sm:p-10">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          Conectar {displayName}?
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-text">
          Este aplicativo quer agir no seu Post Engineer (criar personas, gerar vídeos e agendar
          posts) com a sua conta <span className="font-medium text-ink">{user.email}</span>.
        </p>
        <ul className="mt-5 space-y-2">
          {scopes.map((scope) => (
            <li
              key={scope}
              className="rounded-xl bg-surface px-4 py-2.5 text-sm font-medium text-ink ring-1 ring-hairline"
            >
              <code>{scope}</code>
            </li>
          ))}
        </ul>
        <form method="POST" action="/oauth/approve" className="mt-7 flex flex-col gap-3">
          <input type="hidden" name="request" value={token} />
          <button
            type="submit"
            name="decision"
            value="approve"
            className="w-full rounded-2xl bg-brand px-4 py-3.5 text-sm font-semibold text-white transition-all hover:-translate-y-px hover:bg-brand-hover sm:text-base"
          >
            Autorizar acesso
          </button>
          <button
            type="submit"
            name="decision"
            value="deny"
            className="w-full rounded-2xl border border-hairline bg-card px-4 py-3.5 text-sm font-semibold text-ink transition-all hover:border-line sm:text-base"
          >
            Negar
          </button>
        </form>
      </div>
    </div>
  );
}
