import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { SharedMetricsView, SharedRateLimited } from '@/components/ui/shared-metrics-view';
import { resolveSharedPage } from '@/lib/share-links/resolve-shared-page';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Post Engineer',
  description: 'Resumo de métricas e posts da semana',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
  openGraph: {
    title: 'Post Engineer',
    description: 'Resumo de métricas e posts da semana',
    type: 'website',
  },
  twitter: { card: 'summary', title: 'Post Engineer', description: 'Resumo de métricas e posts da semana' },
};

export default async function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const request = new Request('http://share.invalid/', { headers: await headers() });
  const result = await resolveSharedPage(token, request, createSupabaseServiceClient(), new Date());
  if (result.kind === 'not-found') notFound();
  if (result.kind === 'rate-limited') return <SharedRateLimited />;
  return <SharedMetricsView view={result.view} />;
}
