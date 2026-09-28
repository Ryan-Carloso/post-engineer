import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { logger } from '@/lib/logger';

//---------------
// GET /api/persona/video-generations — the user's video generation history
// (for the Posts > History page), newest first. Optional ?limit=
// (default 50, max 200). Rows are written by the video-job and video-status
// routes via lib/generation/video-generation record helpers.
//---------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function parseGenerationsLimit(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

export interface VideoGenerationRow {
  id: string;
  generationId: string;
  engineTaskId: string | null;
  personaName: string | null;
  videoSubject: string | null;
  status: string;
  errorCode: string | null;
  // No errorMessage: the raw engine/upstream text may contain paths or
  // upstream bodies and is kept server-side (DB) for support only. The UI
  // renders the categorized errorCode, so shipping the raw text would only
  // expose it via devtools without ever being displayed.
  tokensRefunded: boolean;
  createdAt: string;
  completedAt: string | null;
}

export async function GET(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  // API-key/OAuth callers have no cookie session, so the service client
  // (scoped by user_id below) is used; web sessions keep the server client.
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();

  const limit = parseGenerationsLimit(new URL(request.url).searchParams.get('limit'));

  const { data, error } = await supabase
    .from('video_generations')
    .select(
      'id, generation_id, engine_task_id, persona_name, video_subject, status, error_code, tokens_refunded, created_at, completed_at',
    )
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('[api/persona/video-generations] list failed', error);
    return NextResponse.json(
      { success: false, error: 'Could not load generation history.' },
      { status: 500 },
    );
  }

  const generations: VideoGenerationRow[] = (data ?? []).map((row) => ({
    id: String(row.id),
    generationId: String(row.generation_id),
    engineTaskId: row.engine_task_id === null ? null : String(row.engine_task_id),
    personaName: row.persona_name === null ? null : String(row.persona_name),
    videoSubject: row.video_subject === null ? null : String(row.video_subject),
    status: String(row.status),
    errorCode: row.error_code === null ? null : String(row.error_code),
    tokensRefunded: row.tokens_refunded === true,
    createdAt: String(row.created_at),
    completedAt: row.completed_at === null ? null : String(row.completed_at),
  }));

  return NextResponse.json({ success: true, generations });
}
