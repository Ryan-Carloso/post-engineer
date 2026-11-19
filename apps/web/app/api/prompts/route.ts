import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { listHubPrompts } from '@/lib/recipes/hub-prompts';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

async function getHandler(request?: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  return NextResponse.json({ success: true, prompts: listHubPrompts() });
}

export const GET = withApiErrorReporting('GET /api/prompts', getHandler, { getUserId: resolveReportingUserId });
