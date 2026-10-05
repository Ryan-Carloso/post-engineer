//---------------
// Server-side API telemetry to PostHog.
//
// Next.js's onRequestError (instrumentation.ts) only fires for unhandled
// (thrown) errors. Routes that catch a failure and return an error response
// never trigger it, so those handled responses were invisible in PostHog.
// withApiErrorReporting closes that gap for every API response:
//
// - 5xx -> PostHog error tracking ($exception) with the route path, the
//   structured error code (when the JSON body carries one), the
//   client-facing errorId (for correlation with user reports), and the
//   user id when the caller provides one via options.getUserId.
// - 4xx -> a server_warning event (same split apiErrorResponse uses).
// - 2xx -> a server_success event (plain event, never an $exception).
//
// 401/403 stay console-only: unauthenticated scanner traffic must not
// become billable analytics volume (same policy as apiErrorResponse).
//
// Reporting is fire-and-forget: it never throws and never mutates the
// response the client receives. Thrown handler errors are deliberately
// left alone — onRequestError already reports those, and catching here
// would double-report.
//
// Responses built by apiErrorResponse already report through logger
// (error for 5xx, warn for 4xx), so apiErrorResponse marks them via
// markApiErrorReported and this wrapper skips them — one PostHog event
// per error response, not two.
//---------------

import { getPostHogServer } from './posthog-server';
import { scrubSecrets } from './scrub';

export interface ApiErrorReportingOptions {
  // Resolve the affected user id for the request. Called lazily, only when
  // a 4xx/5xx is actually reported, so the happy path pays nothing.
  // Best-effort: a throw or an undefined result just omits the user id.
  getUserId?: (request: Request) => string | undefined | Promise<string | undefined>;
}

// Responses already reported (5xx via logger.error, other 4xx via
// logger.warn).
const reportedResponses = new WeakSet<object>();

/**
 * Mark a response as already reported so the wrapper skips it.
 * Called by apiErrorResponse, whose logger call already reported it.
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

async function reportApiIssue(
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
    const message = `[${route}] ${status}${codeStr !== undefined ? ` ${codeStr}` : ''}`;
    if (status >= 500) {
      client.captureException(new Error(message), scrubSecrets(properties));
    } else {
      // 4xx are warnings, not errors: the same event name logger.warn
      // uses, so warnings from every path share one PostHog stream.
      client.capture('server_warning', scrubSecrets({ message, ...properties }));
    }
  } catch {
    // Telemetry must never break the request path.
  }
}

function reportApiSuccess(route: string, status: number): void {
  try {
    // Keep dev/test noise out of PostHog (same convention as logger.ts).
    if (!isProduction()) return;
    const client = getPostHogServer();
    if (!client) return;
    // Plain event, never an $exception. No user id and no body read — the
    // happy path pays nothing beyond the event itself.
    client.capture('server_success', { route, status });
  } catch {
    // Telemetry must never break the request path.
  }
}

/**
 * Wrap a Next.js App Router route handler so every API response is visible
 * in PostHog: 5xx via error tracking ($exception), other 4xx as warnings
 * (server_warning), 2xx as plain success events (server_success).
 * 401/403 stay console-only. The wrapped handler keeps the original call
 * shape — the request stays optional when the handler declares it optional
 * (or takes none at all), plain Request and NextRequest both typecheck,
 * and extra args such as the route-params context pass through. The
 * handler's response is returned untouched, and handler errors rethrow
 * for onRequestError to report.
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
    if (typeof status !== 'number' || reportedResponses.has(response)) return response;
    if (status >= 500) {
      // Fire-and-forget: never awaited, never throws, never mutates the response.
      void reportApiIssue(route, status, response, request, options?.getUserId);
    } else if (status >= 400) {
      // 401/403 stay console-only: unauthenticated scanner traffic must not
      // become billable analytics volume (same policy as apiErrorResponse).
      if (status === 401 || status === 403) return response;
      void reportApiIssue(route, status, response, request, options?.getUserId);
    } else if (status >= 200 && status < 300) {
      reportApiSuccess(route, status);
    }
    return response;
  };
}
