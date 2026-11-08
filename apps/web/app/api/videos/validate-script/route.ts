//---------------
// POST /api/videos/validate-script — mechanical segments-script validation.
//
// Runs ONLY the existing mechanical validation in
// lib/generation/script-segments.ts (the same validation the
// generate-and-schedule route uses). It never debits tokens, never
// schedules, and never calls the engine or Modal: there is no database
// write and no external call on this path at all.
//
// Measured hook duration is a documented Phase 1 gap: no hook-only TTS
// endpoint exists yet, so the response reports measuredDurationSeconds as
// null with measured 'pending' and an explicit reason — it never invents
// a duration. The hook word guard (15-40 words) already ran in the
// mechanical validation above.
//---------------

import { NextResponse } from 'next/server';

import { requireSupabaseSession } from '@/lib/request-auth';
import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES } from '@/lib/error-codes';
import {
  HOOK_MAX_SECONDS,
  HOOK_MIN_SECONDS,
  validateSegments,
} from '@/lib/generation/script-segments';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { FACELESS_MATERIALS, type FacelessMaterial } from '@/lib/generation/faceless-materials';

const ROUTE = 'POST /api/videos/validate-script';

// The reason measured duration stays pending: kept as one constant so the
// response field and the MCP description cannot drift apart in wording.
export const MEASURED_DURATION_PENDING_REASON =
  'No hook-only TTS endpoint exists yet, so the measured hook duration cannot be checked in this phase.';

function isFacelessMaterial(value: unknown): value is FacelessMaterial {
  return FACELESS_MATERIALS.some((material) => material === value);
}

async function postHandler(request: Request): Promise<NextResponse> {
  // Auth first: the same session-or-API-key auth as the other video
  // routes (requireSupabaseSession). Unauthenticated callers get the
  // auth error before any validation result.
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiErrorResponse(400, 'Invalid JSON payload.', {
      code: ERROR_CODES.VALIDATION_FAILED,
      route: ROUTE,
    });
  }
  const fields = typeof body === 'object' && body !== null ? (body as { segments?: unknown; facelessMaterial?: unknown }) : {};
  // Optional, like on generate-and-schedule: "images" needs media on every
  // segment. An unknown value is a 400, never silently read as "broll".
  const material = fields.facelessMaterial;
  if (material !== undefined && !isFacelessMaterial(material)) {
    return apiErrorResponse(400, `facelessMaterial must be one of: ${FACELESS_MATERIALS.join(', ')}.`, {
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'facelessMaterial',
      route: ROUTE,
    });
  }
  const result = validateSegments(fields.segments, material);
  if (!result.ok) {
    return apiErrorResponse(400, `${result.error.rule} Fix: ${result.error.fix}`, {
      code: ERROR_CODES.VALIDATION_FAILED,
      field: result.error.field,
      route: ROUTE,
      extra: { rule: result.error.rule, fix: result.error.fix },
    });
  }
  const value = result.value;
  return NextResponse.json({
    success: true,
    valid: true,
    segmentCount: value.segmentCount,
    totalWords: value.totalWords,
    hookWords: value.hookWords,
    bodyWords: value.bodyWords,
    ctaWords: value.ctaWords,
    mediaCount: value.mediaCount,
    hookWindowSeconds: { min: HOOK_MIN_SECONDS, max: HOOK_MAX_SECONDS },
    measuredDurationSeconds: null,
    measured: 'pending',
    measuredReason: MEASURED_DURATION_PENDING_REASON,
  });
}

export const POST = withApiErrorReporting(ROUTE, postHandler, { getUserId: resolveReportingUserId });
