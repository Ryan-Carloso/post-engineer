import { AppShell } from "@/components/ui/app-shell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import PublicPromptsFrame from "./components/public-prompts-frame";

//---------------
// Prompts hub layout — /recipes is public (middleware), but it is
// also a sidebar tab of the dashboard. A signed-in visitor gets the
// same AppShell as every (main) page so the tabs never disappear;
// a signed-out visitor gets the public frame (back link + footer).
//---------------

export default async function RecipesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error !== null && error.name !== "AuthSessionMissingError") {
    console.error("[recipes] getUser failed, rendering public frame", {
      message: error.message,
    });
  }
  if (data.user !== null) return <AppShell>{children}</AppShell>;
  return <PublicPromptsFrame>{children}</PublicPromptsFrame>;
}
