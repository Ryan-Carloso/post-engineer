import { AppShell } from '@/components/ui/app-shell';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import PublicPromptsFrame from './components/public-prompts-frame';
import { ViewerProvider } from './viewer-context';

export default async function RecipesLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error !== null && error.name !== 'AuthSessionMissingError') {
    console.error('[recipes] getUser failed, rendering public frame', {
      message: error.message,
    });
  }
  if (data.user !== null) {
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
