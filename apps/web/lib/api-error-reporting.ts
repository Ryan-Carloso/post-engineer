import { getPostHogServer } from './posthog-server';
import { rejectionEventName, successEventName } from './api-telemetry-names';
import { scrubSecrets } from './scrub';
import { requireSupabaseSession } from './request-auth';
import { recordMcpToolCall } from './mcp-tool-telemetry';

export interface ReportingUser {
  userId: string;
  displayName?: string;
}

export interface ApiErrorReportingOptions {
  getUserId?: (
    request: Request,
  ) => string | ReportingUser | undefined | Promise<string | ReportingUser | undefined>;

  reportSuccess?: boolean;
}

export async function resolveReportingUserId(request: Request): Promise<ReportingUser | undefined> {
  try {
    const { auth } = await requireSupabaseSession(request);
    if (auth === null) return undefined;
    const userId = asNonEmptyString(auth.userId);
    if (userId === undefined) return undefined;
    const user: ReportingUser = { userId };
    const displayName = asDisplayName(auth.displayName);
    if (displayName !== undefined) user.displayName = displayName;
    return user;
  } catch {
    return undefined;
  }
}

const reportedResponses = new WeakSet<object>();

const attachedProperties = new WeakMap<object, Record<string, unknown>>();

export function attachApiErrorProperties(response: object, properties: Record<string, unknown>): void {
  attachedProperties.set(response, properties);
}

export function markApiErrorReported(response: object): void {
  reportedResponses.add(response);
}

interface ErrorBody {
  code?: unknown;
  errorId?: unknown;
}

async function readErrorDetails(response: Response): Promise<ErrorBody> {
  try {
    const body: unknown = await response.clone().json();
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return {};
    const { code, errorId } = body as ErrorBody;
    return { code, errorId };
  } catch {
    return {};
  }
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asDisplayName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function resolveUser(
  request: Request | undefined,
  getUserId?: ApiErrorReportingOptions['getUserId'],
): Promise<ReportingUser | undefined> {
  if (getUserId === undefined || request === undefined) return undefined;
  try {
    const resolved = await getUserId(request);
    if (typeof resolved === 'string') {
      const userId = asNonEmptyString(resolved);
      return userId === undefined ? undefined : { userId };
    }
    if (resolved === null || resolved === undefined) return undefined;
    const userId = asNonEmptyString(resolved.userId);
    if (userId === undefined) return undefined;
    const user: ReportingUser = { userId };
    const displayName = asDisplayName(resolved.displayName);
    if (displayName !== undefined) user.displayName = displayName;
    return user;
  } catch {
    return undefined;
  }
}

function withUserProperties(
  properties: Record<string, unknown>,
  user: ReportingUser,
): Record<string, unknown> {
  properties.userId = user.userId;
  if (user.displayName !== undefined) {
    properties.$set = { name: user.displayName };
  }
  return properties;
}

async function reportApiIssue(
  route: string,
  status: number,
  response: Response,
  request: Request | undefined,
  getUserId?: ApiErrorReportingOptions['getUserId'],
): Promise<void> {
  if (status === 401) return;
  try {
    const client = getPostHogServer();
    if (!client) return;

    const { code, errorId } = await readErrorDetails(response);
    const user = await resolveUser(request, getUserId);

    const codeStr = asNonEmptyString(code);
    const errorIdStr = asNonEmptyString(errorId);
    const properties: Record<string, unknown> = { route, status };
    if (codeStr !== undefined) properties.code = codeStr;
    if (errorIdStr !== undefined) properties.errorId = errorIdStr;
    if (user !== undefined) withUserProperties(properties, user);
    if (attachedProperties.has(response)) {
      Object.assign(properties, attachedProperties.get(response));
    }

    const message = `[${route}] ${status}${codeStr !== undefined ? ` ${codeStr}` : ''}`;
    if (status >= 500) {
      properties.$exception_message = message;
      properties.$exception_type = 'Error';
      if (user !== undefined) {
        client.captureExceptionAs(user.userId, new Error(message), scrubSecrets(properties));
      } else {
        client.captureException(new Error(message), scrubSecrets(properties));
      }
    } else {
      const event = rejectionEventName(route) ?? 'server_warning';
      if (user !== undefined) {
        client.captureAs(user.userId, event, scrubSecrets({ message, ...properties }));
      } else {
        client.capture(event, scrubSecrets({ message, ...properties }));
      }
    }
  } catch {
  }
}

async function reportApiSuccess(
  route: string,
  status: number,
  response: Response,
  request: Request | undefined,
  getUserId?: ApiErrorReportingOptions['getUserId'],
): Promise<void> {
  try {
    const client = getPostHogServer();
    if (!client) return;
    const user = await resolveUser(request, getUserId);
    const properties: Record<string, unknown> = { route, status };
    if (user !== undefined) withUserProperties(properties, user);
    if (attachedProperties.has(response)) {
      Object.assign(properties, attachedProperties.get(response));
    }
    const event = successEventName(route) ?? 'server_success';
    if (user !== undefined) {
      client.captureAs(user.userId, event, properties);
    } else {
      client.capture(event, properties);
    }
  } catch {
  }
}

export function withApiErrorReporting<TReq extends Request | undefined, TArgs extends unknown[]>(
  route: string,
  handler: (request: TReq, ...args: TArgs) => Promise<Response> | Response,
  options?: ApiErrorReportingOptions,
): (request?: TReq, ...args: TArgs) => Promise<Response>;
export function withApiErrorReporting(
  route: string,
  handler: (request?: Request, ...args: unknown[]) => Promise<Response> | Response,
  options?: ApiErrorReportingOptions,
): (request?: Request, ...args: unknown[]) => Promise<Response> {
  return async (request?: Request, ...args: unknown[]): Promise<Response> => {
    let response: Response;
    try {
      response = await handler(request, ...args);
    } catch (error) {
      recordMcpToolCall(request, 500);
      throw error;
    }
    const status = (response as { status?: unknown } | null | undefined)?.status;
    if (typeof status === 'number') recordMcpToolCall(request, status);
    if (typeof status !== 'number' || reportedResponses.has(response)) return response;
    if (status >= 400) {
      void reportApiIssue(route, status, response, request, options?.getUserId);
    } else if (status >= 200 && status < 300 && options?.reportSuccess !== false) {
      void reportApiSuccess(route, status, response, request, options?.getUserId);
    }
    return response;
  };
}
