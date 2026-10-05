//---------------
// Server-side API 5xx reporting to PostHog.
//
// Next.js's onRequestError (instrumentation.ts) only fires for unhandled
// (thrown) errors. Routes that catch a failure and return a 500 response
// never trigger it, so those handled 5xx responses were invisible in
// PostHog. withApiErrorReporting closes that gap: after the handler
// returns, a 5xx status is reported to PostHog error tracking with the
// route path, the structured error code (when the JSON body carries one),
// the client-facing errorId (for correlation with user reports), and the
// user id when the caller provides one via options.getUserId.
//
// Reporting is fire-and-forget: it never throws and never mutates the
// response the client receives. Thrown handler errors are deliberately
// left alone — onRequestError already reports those, and catching here
// would double-report.
//
// Responses built by apiErrorResponse already report through logger.error,
// so apiErrorResponse marks them via markApiErrorReported and this wrapper
// skips them — one $exception per 5xx, not two.
//---------------

import { getPostHogServer } from './posthog-server';
import { scrubSecrets } from './scrub';

export interface ApiErrorReportingOptions {
  // Resolve the affected user id for the request. Called lazily, only when
  // a 5xx is actually reported, so the happy path pays nothing.
  // Best-effort: a throw or an undefined result just omits the user id.
  getUserId?: (request: Request) => string | undefined | Promise<string | undefined>;
}

// Responses whose 5xx was already reported (apiErrorResponse -> logger).
const reportedResponses = new WeakSet<object>();

/**
 * Mark a 5xx response as already reported so the wrapper skips it.
 * Called by apiErrorResponse, whose logger.error already reports 5xx.
 */
export function markApiErrorReported(response: object): void {
  reportedResponses.add(response);
}

function isProduction(): boolean {
  // Read at call time (like logger.ts) so tests can stub NODE_ENV.
  return process.env.NODE_ENV === 'production';
}

interface ErrorBody {
  code?: unknown;
  errorId?: unknown;
}

async function readErrorDetails(response: Response): Promise<ErrorBody> {
  try {
    // Clone before reading: the original body must stay intact for the client.
    const body: unknown = await response.clone().json();
    // Structural guard: only plain objects carry code/errorId. (Property
    // access on primitives would not throw, but the guard keeps the cast
    // below honest for future edits.)
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return {};
    const { code, errorId } = body as ErrorBody;
    return { code, errorId };
  } catch {
    // Non-JSON body — report without code/errorId.
    return {};
  }
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function reportApiServerError(
  route: string,
  status: number,
  response: Response,
  request: Request | undefined,
  getUserId?: ApiErrorReportingOptions['getUserId'],
): Promise<void> {
  try {
    // Keep dev/test noise out of PostHog (same convention as logger.ts).
    if (!isProduction()) return;
    const client = getPostHogServer();
    if (!client) return;

    const { code, errorId } = await readErrorDetails(response);
    let userId: string | undefined;
    if (getUserId !== undefined && request !== undefined) {
      try {
        userId = asNonEmptyString(await getUserId(request));
      } catch {
        userId = undefined;
      }
    }

    const codeStr = asNonEmptyString(code);
    const errorIdStr = asNonEmptyString(errorId);
    const properties: Record<string, unknown> = { route, status };
    if (codeStr !== undefined) properties.code = codeStr;
    if (errorIdStr !== undefined) properties.errorId = errorIdStr;
    if (userId !== undefined) properties.userId = userId;

    // Stable, low-cardinality message so PostHog groups by route + code,
    // never by user-controlled text.
    const error = new Error(`[${route}] ${status}${codeStr !== undefined ? ` ${codeStr}` : ''}`);
    client.captureException(error, scrubSecrets(properties));
  } catch {
    // Telemetry must never break the request path.
  }
}

/**
 * Wrap a Next.js App Router route handler so handled 5xx responses are
 * reported to PostHog error tracking. The wrapped handler keeps the
 * original call shape — the request stays optional when the handler
 * declares it optional (or takes none at all), plain Request and
 * NextRequest both typecheck, and extra args such as the route-params
 * context pass through. The handler's response is returned untouched,
 * and handler errors rethrow for onRequestError to report.
 */
export function withApiErrorReporting<TReq extends Request | undefined, TArgs extends unknown[]>(
  route: string,
  handler: (request: TReq, ...args: TArgs) => Promise<Response> | Response,
  options?: ApiErrorReportingOptions,
): (request?: TReq, ...args: TArgs) => Promise<Response>;
// Implementation signature (not visible to callers): the request is only
// ever undefined when the wrapped handler declares it optional, so passing
// it through positionally is safe.
export function withApiErrorReporting(
  route: string,
  handler: (request?: Request, ...args: unknown[]) => Promise<Response> | Response,
  options?: ApiErrorReportingOptions,
): (request?: Request, ...args: unknown[]) => Promise<Response> {
  return async (request?: Request, ...args: unknown[]): Promise<Response> => {
    const response = await handler(request, ...args);
    const status = (response as { status?: unknown } | null | undefined)?.status;
    if (typeof status === 'number' && status >= 500 && !reportedResponses.has(response)) {
      // Fire-and-forget: never awaited, never throws, never mutates the response.
      void reportApiServerError(route, status, response, request, options?.getUserId);
    }
    return response;
  };
}
