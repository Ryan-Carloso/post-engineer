import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { checkAndDeductTokens } from '@/lib/billing/token-check';
import { secretsMatch } from '@/lib/secrets';
import type { FaceQuality } from '@/lib/tokens';

//---------------
// POST /api/billing/check-tokens — checks and deducts tokens.
// Used by the engine (Python) before generating scheduled videos.
// Authentication: MONEYPRINT_API_SECRET in the x-engine-secret header
// (compared in constant time — never a plain === on secrets).
//---------------

function getEngineSecret(): string {
  const secret = process.env.MONEYPRINT_API_SECRET;
  if (!secret) throw new Error('MONEYPRINT_API_SECRET is not defined');
  return secret;
}

export async function POST(request: Request): Promise<NextResponse> {
  // Authentication via the engine shared secret
  let engineSecret: string;
  try {
    engineSecret = getEngineSecret();
  } catch {
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

  let body: { userId?: unknown; generationId?: unknown; faceMixPercent?: unknown; faceQuality?: unknown };
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

  const faceMixPercent = typeof body.faceMixPercent === 'number' && Number.isFinite(body.faceMixPercent)
    ? body.faceMixPercent
    : 0;
  const faceQuality: FaceQuality =
    body.faceQuality === 'very_good' ? 'very_good' : 'ok';

  const supabase = createSupabaseServiceClient();

  const result = await checkAndDeductTokens(
    supabase,
    body.userId,
    generationId,
    faceMixPercent,
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
