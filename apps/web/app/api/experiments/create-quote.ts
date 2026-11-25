import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { CreateExperimentBody } from '@/lib/contracts/experiments';
import { quoteExpiry } from '@/lib/experiments/quote-key';
import type { SupabaseSessionAuth } from '@/lib/request-auth';
import { planExperiment, quoteKeyOf } from './create-plan';

export async function quoteExperiment(
  supabase: SupabaseClient,
  auth: SupabaseSessionAuth,
  body: CreateExperimentBody,
  now: Date,
): Promise<NextResponse> {
  const plan = await planExperiment(supabase, auth, body);
  if (plan instanceof NextResponse) return plan;
  const expiresAt = quoteExpiry(now);
  return NextResponse.json({
    success: true,
    stage: 'quote',
    quoteKey: quoteKeyOf(plan, expiresAt),
    expiresAt,
    perVideoTokens: plan.perVideoCost,
    totalTokens: plan.totalTokens,
    videos: plan.videos.length,
    slots: plan.videos.map((video) => ({
      slotAt: video.slot.slotAtISO,
      versionId: video.versionId,
      title: video.title,
    })),
    warnings: plan.warnings,
  });
}
