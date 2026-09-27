'use client';

import { AppShell } from '@/components/ui/app-shell';

//---------------
// MainLayout — logged-in area layout; the shell lives in components/ui/app-shell
// so it can be reused by public pages that render authenticated.
//---------------
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
