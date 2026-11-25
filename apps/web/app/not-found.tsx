import type { Metadata } from 'next';
import { AppShell } from '@/components/ui/app-shell';
import { NotFoundView } from '@/components/not-found-view';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: '404 — Post Engineer',
  robots: { index: false },
};

export default async function NotFound() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error !== null && error.name !== 'AuthSessionMissingError') {
    console.error('[not-found] getClaims failed, rendering signed out', {
      name: error.name,
      status: error.status ?? null,
    });
  }
  const subject: unknown = data?.claims.sub;
  const signedIn = error === null && typeof subject === 'string' && subject.length > 0;

  if (signedIn) {
    return (
      <AppShell>
        <NotFoundView signedIn />
      </AppShell>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface">
      <NotFoundView signedIn={false} />
    </main>
  );
}
