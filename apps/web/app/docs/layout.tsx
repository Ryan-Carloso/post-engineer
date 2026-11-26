import SiteFooter from '@/components/site-footer';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-16">{children}</main>
      <SiteFooter />
    </div>
  );
}
