import Link from 'next/link';
import SiteFooter from '@/components/site-footer';

//---------------
// PublicPromptsFrame — page frame for signed-out visitors of the
// prompts hub: same paper background and padding as the AppShell
// content area, a back link to the site, and the public footer.
//---------------

export default function PublicPromptsFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[#f7f8fa]">
      <main className="w-full flex-1 px-4 pt-6 pb-16 sm:px-6 md:px-8 md:pt-10 lg:px-10">
        <div className="mx-auto mb-6 w-full max-w-375">
          <Link href="/" className="text-sm text-[#718096] hover:text-[#101728]">
            ← Post Engineer
          </Link>
        </div>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
