import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { listHubPrompts } from '@/lib/recipes/hub-prompts';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

//---------------
// GET /api/prompts — recipe prompt catalog for the MCP (list_prompts tool
// and slash commands): slug, title, description, no prompt text.
// Auth = Supabase session (cookie) OR personal API key / OAuth (MCP).
// Static in-memory data, no fan-out: no rate limit, like /api/persona/faces.
//---------------

async function getHandler(request?: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  return NextResponse.json({ success: true, prompts: listHubPrompts() });
}

export const GET = withApiErrorReporting('GET /api/prompts', getHandler, { getUserId: resolveReportingUserId });
