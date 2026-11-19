import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { checkAndDeductTokens } from '@/lib/billing/token-check';
import { secretsMatch } from '@/lib/secrets';
import { logger } from '@/lib/logger';
import { isVideoType, unknownVideoTypeMessage, type FaceQuality, type VideoType } from '@/lib/tokens';
import { withApiErrorReporting } from '@/lib/api-error-reporting';

function getEngineSecret(): string {
  const secret = process.env.MONEYPRINT_API_SECRET;
  if (!secret) throw new Error('MONEYPRINT_API_SECRET is not defined');
  return secret;
}

async function postHandler(request: Request): Promise<NextResponse> {
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

export const POST = withApiErrorReporting('POST /api/billing/check-tokens', postHandler);
