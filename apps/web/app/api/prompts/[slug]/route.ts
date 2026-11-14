import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { findHubPrompt } from '@/lib/recipes/hub-prompts';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

//---------------
// GET /api/prompts/[slug] — one recipe prompt with its full text, for the
// MCP prompts (action: get) tool and slash commands. Unknown slug → 404 with the
// stable PROMPT_NOT_FOUND code (the MCP then lists the valid slugs).
// Auth = Supabase session (cookie) OR personal API key / OAuth (MCP).
//---------------

type RouteContext = { params: Promise<{ slug: string }> };

async function getHandler(request: Request, context: RouteContext): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  const { slug: rawSlug } = await context.params;
  let slug: string;
  try {
    slug = decodeURIComponent(rawSlug);
  } catch {
    return NextResponse.json({ success: false, error: 'Malformed prompt slug.' }, { status: 400 });
  }

  const prompt = findHubPrompt(slug);
  if (prompt === null) {
    return NextResponse.json(
      { success: false, error: 'Unknown prompt slug.', code: 'PROMPT_NOT_FOUND' },
      { status: 404 },
    );
  }
  return NextResponse.json({ success: true, prompt });
}

export const GET = withApiErrorReporting('GET /api/prompts/[slug]', getHandler, { getUserId: resolveReportingUserId });
