import { NextResponse } from 'next/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import {
  getToolConfig,
  saveToolConfig,
  toToolConfigPresence,
  ToolConfigValidationError,
  ToolConfigUnreadableError,
} from '@/lib/tool-config';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

const ROUTE = 'GET /api/tool-config';
const PUT_ROUTE = 'PUT /api/tool-config';

async function resolveContext(
  request: Request,
  route: string,
): Promise<{ userId: string } | NextResponse> {
  const session = await requireSupabaseSession(request);
  if (session.error || !session.auth) {
    return session.error ?? apiErrorResponse(401, 'Unauthorized.', { route });
  }
  const limited = await applyRateLimit(request, RATE_LIMITS.toolConfig, session.auth.userId);
  if (limited) return limited;
  return { userId: session.auth.userId };
}

function libErrorToResponse(route: string, error: unknown): NextResponse {
  if (error instanceof ToolConfigValidationError) {
    return apiErrorResponse(400, error.message, {
      route,
      code: ERROR_CODES.VALIDATION_FAILED,
      field: error.field,
    });
  }
  if (error instanceof ToolConfigUnreadableError) {
    return apiErrorResponse(500, error.message, { route, code: ERROR_CODES.INTERNAL_ERROR });
  }
  logger.error('[api/tool-config] lookup failed', error, { route });
  return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
    route,
    code: ERROR_CODES.INTERNAL_ERROR,
  });
}

async function getHandler(request: Request): Promise<NextResponse> {
  const ctx = await resolveContext(request, ROUTE);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const config = await getToolConfig(createSupabaseServiceClient(), ctx.userId);
    if (config === null) {
      return NextResponse.json({
        success: true,
        configured: false,
        searchTool: null,
        stockSources: [],
        keysPresent: { tavily: false, exa: false, pexels: false, pixabay: false, coverr: false },
        keysLast4: { tavily: null, exa: null, pexels: null, pixabay: null, coverr: null },
      });
    }
    const presence = toToolConfigPresence(config);
    return NextResponse.json({
      success: true,
      configured: true,
      searchTool: presence.searchTool,
      stockSources: presence.stockSources,
      keysPresent: presence.keysPresent,
      keysLast4: presence.keysLast4,
    });
  } catch (error) {
    return libErrorToResponse(ROUTE, error);
  }
}

async function putHandler(request: Request): Promise<NextResponse> {
  const ctx = await resolveContext(request, PUT_ROUTE);
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return apiErrorResponse(400, 'Request body must be valid JSON.', {
      route: PUT_ROUTE,
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'config',
    });
  }

  try {
    const presence = await saveToolConfig(createSupabaseServiceClient(), ctx.userId, body);
    return NextResponse.json({
      success: true,
      configured: true,
      searchTool: presence.searchTool,
      stockSources: presence.stockSources,
      keysPresent: presence.keysPresent,
      keysLast4: presence.keysLast4,
    });
  } catch (error) {
    return libErrorToResponse(PUT_ROUTE, error);
  }
}

export const GET = withApiErrorReporting(ROUTE, getHandler, { getUserId: resolveReportingUserId });
export const PUT = withApiErrorReporting(PUT_ROUTE, putHandler, { getUserId: resolveReportingUserId });
