import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const MOCK_AVATAR_URL =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">' +
      '<rect width="256" height="256" fill="#e5e5e5"/>' +
      '<circle cx="128" cy="100" r="48" fill="#a3a3a3"/>' +
      '<ellipse cx="128" cy="210" rx="80" ry="60" fill="#a3a3a3"/>' +
      '</svg>',
  );

async function postHandler(request: Request): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: sessionError,
  } = await supabase.auth.getUser();

  if (sessionError || !user) {
    return NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
  }
  const limited = await applyRateLimit(request, RATE_LIMITS.personaAvatar, user.id);
  if (limited) return limited;

  const body: unknown = await request.json().catch(() => null);
  const prompt =
    typeof body === 'object' && body !== null && 'prompt' in body
      ? (body as { prompt: unknown }).prompt
      : undefined;

  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return NextResponse.json(
      { success: false, error: 'Prompt é obrigatório' },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    imageUrl: MOCK_AVATAR_URL,
  });
}

export const POST = withApiErrorReporting('POST /api/persona/avatar', postHandler, { getUserId: resolveReportingUserId });
