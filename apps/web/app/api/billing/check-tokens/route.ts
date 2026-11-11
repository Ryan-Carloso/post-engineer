import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { checkAndDeductTokens } from '@/lib/billing/token-check';
import { secretsMatch } from '@/lib/secrets';
import { logger } from '@/lib/logger';
import { isVideoType, unknownVideoTypeMessage, type FaceQuality, type VideoType } from '@/lib/tokens';
import { withApiErrorReporting } from '@/lib/api-error-reporting';

//---------------
// POST /api/billing/check-tokens — checks and deducts tokens.
// Authentication: MONEYPRINT_API_SECRET in the x-engine-secret header
// (compared in constant time — never a plain === on secrets).
//---------------

//---------------
// Body contract: { userId, generationId?, videoType?, faceQuality? }.
// videoType is the one video mode (issue #542 follow-up); absent means
// hook_lipsync (the old default: a faced video). An unknown mode is a 400
// naming every mode with its cost, never silently priced as another mode.
//---------------

function getEngineSecret(): string {
  const secret = process.env.MONEYPRINT_API_SECRET;
  if (!secret) throw new Error('MONEYPRINT_API_SECRET is not defined');
  return secret;
}

async function postHandler(request: Request): Promise<NextResponse> {
  // Authentication via the engine shared secret
  let engineSecret: string;
  try {
    engineSecret = getEngineSecret();
  } catch (error) {
    logger.error('[api/billing/check-tokens] engine secret not configured', error);
    return NextResponse.json(
      { success: false, error: 'Service not configured.' },
      { status: 500 },
    );
  }

  const providedSecret = request.headers.get('x-engine-secret');
  if (!providedSecret || !secretsMatch(providedSecret, engineSecret)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized.' },
      { status: 401 },
    );
  }

  let body: { userId?: unknown; generationId?: unknown; videoType?: unknown; faceQuality?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON payload.' },
      { status: 400 },
    );
  }

  if (typeof body.userId !== 'string' || body.userId.length === 0) {
    return NextResponse.json(
      { success: false, error: 'userId is required.' },
      { status: 400 },
    );
  }

  const generationId = typeof body.generationId === 'string' && body.generationId.length > 0
    ? body.generationId
    : randomUUID();

  let videoType: VideoType = 'hook_lipsync';
  if (body.videoType !== undefined) {
    if (!isVideoType(body.videoType)) {
      return NextResponse.json(
        { success: false, error: unknownVideoTypeMessage(body.videoType) },
        { status: 400 },
      );
    }
    videoType = body.videoType;
  }
  const faceQuality: FaceQuality =
    body.faceQuality === 'very_good' ? 'very_good' : 'ok';

  const supabase = createSupabaseServiceClient();

  const result = await checkAndDeductTokens(
    supabase,
    body.userId,
    generationId,
    videoType,
    faceQuality,
  );

  if (!result.ok) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: result.statusCode },
    );
  }

  return NextResponse.json({ success: true, cost: result.cost, generationId });
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const POST = withApiErrorReporting('POST /api/billing/check-tokens', postHandler);
