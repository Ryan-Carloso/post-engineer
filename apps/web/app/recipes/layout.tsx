import { AppShell } from '@/components/ui/app-shell';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import PublicPromptsFrame from './components/public-prompts-frame';
import { ViewerProvider } from './viewer-context';

export default async function RecipesLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error !== null && error.name !== 'AuthSessionMissingError') {
    console.error('[recipes] getClaims failed, rendering public frame', {
      message: error.message,
    });
  }
  const subject: unknown = data?.claims.sub;
  if (error === null && typeof subject === 'string' && subject.length > 0) {
    return (
      <AppShell>
        <ViewerProvider signedIn>{children}</ViewerProvider>
      </AppShell>
    );
  }
  return (
    <PublicPromptsFrame>
      <ViewerProvider signedIn={false}>{children}</ViewerProvider>
    </PublicPromptsFrame>
  );
}
