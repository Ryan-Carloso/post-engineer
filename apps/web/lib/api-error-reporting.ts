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
// - 4xx (including 401/403) -> a warning event named after the route's
//   semantic name + `_rejected` (e.g. `persona_created_rejected`), falling
//   back to the generic `server_warning` for unmapped labels.
// - 2xx -> a plain success event (never an $exception) named after the
//   route's semantic name (e.g. `billing_transactions_fetched`, see
//   api-telemetry-names.ts), falling back to the generic
//   `server_success` for unmapped labels, with the user id when the
//   route opted in via options.getUserId.
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
import { rejectionEventName, successEventName } from './api-telemetry-names';
import { scrubSecrets } from './scrub';

export interface ApiErrorReportingOptions {
  // Resolve the affected user id for the request. Called lazily, only for
  // responses that are actually reported, and only on routes that opt in —
  // routes without getUserId pay nothing. Best-effort: a throw or an
  // undefined result just omits the user id.
  getUserId?: (request: Request) => string | undefined | Promise<string | undefined>;

  // Skip the 2xx success event. Default true: every 2xx emits the route's
  // semantic success name. Set to false on high-frequency polling routes
  // (e.g. video-status) where each poll is routine noise — 4xx warnings
  // and 5xx $exceptions are still reported.
  reportSuccess?: boolean;
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

// Best-effort user id resolution. Only called on routes that opted in via
// options.getUserId; a throw or an undefined result just omits the user id.
async function resolveUserId(
  request: Request | undefined,
  getUserId?: ApiErrorReportingOptions['getUserId'],
): Promise<string | undefined> {
  if (getUserId === undefined || request === undefined) return undefined;
  try {
    return asNonEmptyString(await getUserId(request));
  } catch {
    return undefined;
  }
}

async function reportApiIssue(
  route: string,
  status: number,
  response: Response,
  request: Request | undefined,
  getUserId?: ApiErrorReportingOptions['getUserId'],
): Promise<void> {
  try {
    // Tag-and-send (same convention as logger.ts): dev/test events flow
    // with environment: 'development' so the pipeline is validated daily;
    // dashboards filter prod on the tag.
    const client = getPostHogServer();
    if (!client) return;

    const { code, errorId } = await readErrorDetails(response);
    const userId = await resolveUserId(request, getUserId);

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
      // 4xx are warnings, not errors. The event carries the route's
      // semantic name + `_rejected` (see api-telemetry-names.ts); unmapped
      // labels fall back to the generic server_warning. Telemetry must
      // never break on a missing entry.
      const event = rejectionEventName(route) ?? 'server_warning';
      client.capture(event, scrubSecrets({ message, ...properties }));
    }
  } catch {
    // Telemetry must never break the request path.
  }
}

async function reportApiSuccess(
  route: string,
  status: number,
  request: Request | undefined,
  getUserId?: ApiErrorReportingOptions['getUserId'],
): Promise<void> {
  try {
    // Tag-and-send (same convention as logger.ts): dev/test events flow
    // with environment: 'development' so the pipeline is validated daily;
    // dashboards filter prod on the tag.
    const client = getPostHogServer();
    if (!client) return;
    const userId = await resolveUserId(request, getUserId);
    const properties: Record<string, unknown> = { route, status };
    if (userId !== undefined) properties.userId = userId;
    // Plain event, never an $exception. No body read — success bodies are
    // large and varied; route+status is the signal. The event name is the
    // route's semantic name when mapped (see api-telemetry-names.ts);
    // unmapped labels fall back to the generic server_success.
    client.capture(successEventName(route) ?? 'server_success', properties);
  } catch {
    // Telemetry must never break the request path.
  }
}

/**
 * Wrap a Next.js App Router route handler so every API response is visible
 * in PostHog: 5xx via error tracking ($exception), 4xx (including 401/403)
 * as warnings named `<semantic_name>_rejected`, 2xx as plain success events
 * named after the route's semantic name (see api-telemetry-names.ts),
 * with the user id when the route opted in via options.getUserId.
 * High-frequency polling routes can silence the 2xx event (noise) while
 * keeping 4xx/5xx reporting via options.reportSuccess: false. The wrapped handler keeps the original call shape —
 * the request stays optional when the handler declares it optional (or
 * takes none at all), plain Request and NextRequest both typecheck, and
 * extra args such as the route-params context pass through. The handler's
 * response is returned untouched, and handler errors rethrow for
 * onRequestError to report.
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
    // Fire-and-forget: never awaited, never throws, never mutates the response.
    if (status >= 400) {
      void reportApiIssue(route, status, response, request, options?.getUserId);
    } else if (status >= 200 && status < 300 && options?.reportSuccess !== false) {
      void reportApiSuccess(route, status, request, options?.getUserId);
    }
    return response;
  };
}
