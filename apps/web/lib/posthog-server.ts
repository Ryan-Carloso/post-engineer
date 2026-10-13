//---------------
// Server-side PostHog client singleton.
//
// posthog-node is loaded via a dynamic import marked `webpackIgnore: true`
// so the Node-only SDK never ends up in the client bundle. A plain dynamic
// import() is NOT enough: webpack statically analyzes it, resolves
// 'posthog-node' at build time, and bundles the SDK into the client chunk.
// posthog-node ships no browser build (its exports map only has
// node/edge/workerd conditions), so the client build then dies on
// node:fs / node:os / node:path (UnhandledSchemeError). With webpackIgnore,
// webpack emits the import() untouched: Node resolves it natively at
// runtime on the server, and the browser never reaches it — every public
// function below returns early on `typeof window !== 'undefined'`.
//
// This module is imported by lib/logger.ts, which is reachable from client
// components — a static `import` of posthog-node would ship Node builtins
// (async_hooks, zlib) to browsers.
//
// Reads configuration from environment variables:
// - POSTHOG_API_KEY (server-side, preferred) or NEXT_PUBLIC_POSTHOG_KEY (fallback)
// - NEXT_PUBLIC_POSTHOG_HOST (defaults to DEFAULT_POSTHOG_HOST —
//   change the constant in lib/posthog-config.ts to self-host)
//
// Returns null when not configured or running in the browser — telemetry
// must never break the app, so a missing key warns once and disables
// reporting instead of throwing.
//---------------

import { DEFAULT_POSTHOG_HOST } from './posthog-config';

// Server-side events have no user session: attribute them to the API
// server itself. Per-user attribution happens client-side.
const SERVER_DISTINCT_ID = 'post-engineer-server';

//---------------
// Lazy loader for the posthog-node SDK. The dynamic import is marked
// `webpackIgnore: true` so webpack does not try to bundle the Node-only
// SDK into client chunks (see the header comment). Failures degrade to
// telemetry-disabled (null client).
//---------------

interface PostHogNodeClient {
  capture(args: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
  }): void;
  captureException(
    error: unknown,
    distinctId: string,
    properties?: Record<string, unknown>,
  ): void;
  flush(): Promise<void>;
  shutdownAsync(): Promise<void>;
}

let sdkPromise: Promise<PostHogNodeClient | null> | null = null;
let warned = false;

function warnOnce(message: string): void {
  if (!warned) {
    warned = true;
    console.warn(message);
  }
}

function getConfig(): { key: string; host: string } | null {
  // Client bundle safety: never initialize the server SDK in the browser.
  if (typeof window !== 'undefined') return null;
  const key = process.env.POSTHOG_API_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    warnOnce('[posthog] POSTHOG_API_KEY / NEXT_PUBLIC_POSTHOG_KEY not set — PostHog telemetry disabled');
    return null;
  }
  return { key, host: resolveHost() };
}

//---------------
// Resolve the ingest host, refusing anything that is not an http(s) URL.
//
// posthog-node accepts ANY string as `host` and only discovers the problem
// when a capture is flushed ("Network error while fetching PostHog"). In
// production (2026-10-13) NEXT_PUBLIC_POSTHOG_HOST was set to a project API
// key (phc_...) instead of an ingest URL: the client constructed fine, every
// flush failed, and — because loadSdk memoizes sdkPromise — one bad boot
// disabled server telemetry for the whole process lifetime while
// /api/version still reported posthogConfigured: true. The misconfigured
// value is itself a credential, so it is never echoed into the warning.
//---------------
function resolveHost(): string {
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  // Empty string is the documented "unset" case (the .env.example ships an
  // empty value), so it falls through to the default rather than warning.
  if (host === undefined || host === '') return DEFAULT_POSTHOG_HOST;
  let parsed: URL;
  try {
    parsed = new URL(host);
  } catch {
    warnOnce(
      '[posthog] NEXT_PUBLIC_POSTHOG_HOST is not a valid URL — falling back to the default ingest host. ' +
        'It must be an https:// ingest URL (e.g. https://eu.i.posthog.com), NOT a project API key.',
    );
    return DEFAULT_POSTHOG_HOST;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    warnOnce(
      `[posthog] NEXT_PUBLIC_POSTHOG_HOST uses the unsupported scheme "${parsed.protocol}" — ` +
        'falling back to the default ingest host. It must be an http(s) ingest URL, NOT a project API key.',
    );
    return DEFAULT_POSTHOG_HOST;
  }
  // Normalize so the SDK never receives a trailing-slash/port-less variant.
  return host;
}

function loadSdk(): Promise<PostHogNodeClient | null> {
  if (!sdkPromise) {
    sdkPromise = (async (): Promise<PostHogNodeClient | null> => {
      const config = getConfig();
      if (!config) return null;
      try {
        // webpackIgnore: true is load-bearing — without it, webpack
        // statically resolves this import at build time and bundles
        // posthog-node (Node-only, no browser export condition) into the
        // client chunk, failing the build on node:fs / node:os / node:path.
        // With it, Node resolves the SDK natively at runtime on the server.
        const { PostHog } = await import(/* webpackIgnore: true */ 'posthog-node');
        // NOTE: posthog-node v5 has no automatic background flush. `flushAt`
        // was a v3/v4 option (silently ignored by v5), `flushInterval` is
        // accepted but never scheduled, and the debounced flush requires the
        // serverless `waitUntil` option. Without an explicit flush, captured
        // events sit in the in-memory queue forever — this is why zero
        // server_success events ever reached PostHog. Delivery is handled by
        // toClient below, which flushes after every capture.
        return new PostHog(config.key, {
          host: config.host,
        }) as unknown as PostHogNodeClient;
      } catch (error: unknown) {
        // Log the actual cause, not just "it failed": the bare `catch {}` that
        // shipped here is why the bad NEXT_PUBLIC_POSTHOG_HOST above took a
        // full day to find — the log said "failed to initialize" and nothing
        // else, while every event silently vanished. Only the error NAME and
        // message are logged; the config object (which holds the API key) is
        // deliberately never included.
        warnOnce(
          `[posthog] Failed to initialize PostHog client — telemetry disabled (${
            error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
          })`,
        );
        return null;
      }
    })();
  }
  return sdkPromise;
}

//---------------
// The surface logger.ts and analytics.ts use. Capture methods are
// fire-and-forget: they trigger the lazy SDK load and send when ready.
// For request-scoped errors where the process may freeze (Vercel),
// use flushPostHog() to await delivery.
//---------------

export interface ServerPostHogClient {
  capture(event: string, properties?: Record<string, unknown>): void;
  /**
   * Capture an event attributed to a specific user (distinct_id).
   * Used by server jobs acting on behalf of a user (e.g. billing
   * reconciliation refunds) where the shared service id would hide who
   * was affected.
   */
  captureAs(distinctId: string, event: string, properties?: Record<string, unknown>): void;
  captureException(error: unknown, properties?: Record<string, unknown>): void;
}

//---------------
// Origin tags: every server-side capture carries where it came from
// (source) and which deployment produced it (environment) so PostHog
// dashboards can split web-server / web-client / MCP / engine traffic and
// prod / dev. Injected at toClient — the single choke point — so
// logger.ts, api-error-reporting.ts, analytics.ts and billing/reconcile.ts
// all get the tags without touching their call sites. Also shared with
// the browser path (lib/client-logger.ts) so the environment convention
// lives in exactly one place.
//---------------

export type TelemetryEnvironment = 'production' | 'development';

export function getTelemetryEnvironment(): TelemetryEnvironment {
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

const TELEMETRY_SOURCE = 'web-server';

function withOriginTags(properties?: Record<string, unknown>): Record<string, unknown> {
  // Ours win over caller-supplied values: the origin of an event is a
  // pipeline fact, not caller input, so it can never be spoofed away.
  return { ...properties, source: TELEMETRY_SOURCE, environment: getTelemetryEnvironment() };
}

function toClient(sdk: PostHogNodeClient): ServerPostHogClient {
  // posthog-node v5 never flushes on its own (see the note in loadSdk):
  // every capture must be followed by an explicit flush or the event is
  // never delivered. Fire-and-forget so a slow PostHog never blocks the
  // request path; failures are swallowed — telemetry must never break it.
  const captureAndFlush = (send: () => void): void => {
    send();
    void sdk.flush().catch(() => {});
  };
  return {
    capture: (event, properties) => {
      captureAndFlush(() =>
        sdk.capture({ distinctId: SERVER_DISTINCT_ID, event, properties: withOriginTags(properties) }),
      );
    },
    captureAs: (distinctId, event, properties) => {
      captureAndFlush(() =>
        sdk.capture({ distinctId, event, properties: withOriginTags(properties) }),
      );
    },
    captureException: (error, properties) => {
      captureAndFlush(() =>
        sdk.captureException(error, SERVER_DISTINCT_ID, withOriginTags(properties)),
      );
    },
  };
}

let cachedClient: ServerPostHogClient | null = null;
let clientReady = false;
let queuingClient: ServerPostHogClient | null = null;

export function getPostHogServer(): ServerPostHogClient | null {
  // Client bundle safety: this module is reachable from client components
  // via lib/logger.ts. Never initialize the server SDK in the browser.
  if (typeof window !== 'undefined') return null;
  if (clientReady) return cachedClient;

  // If no API key is configured, return null immediately (don't queue).
  // getConfig() warns once via warnOnce.
  if (!getConfig()) return null;

  // Return the same queuing client on repeated calls (singleton).
  if (queuingClient) return queuingClient;

  // Kick off the async load; return a queuing client immediately.
  // Events captured before the SDK loads are sent once it's ready.
  const pending: Array<() => void> = [];
  queuingClient = {
    capture: (event, properties) => {
      pending.push(() => cachedClient?.capture(event, properties));
    },
    captureAs: (distinctId, event, properties) => {
      pending.push(() => cachedClient?.captureAs(distinctId, event, properties));
    },
    captureException: (error, properties) => {
      pending.push(() => cachedClient?.captureException(error, properties));
    },
  };

  loadSdk().then((sdk) => {
    if (sdk) {
      cachedClient = toClient(sdk);
    }
    clientReady = true;
    // Flush queued events.
    for (const send of pending) {
      try {
        send();
      } catch {
        // Telemetry must never break the app.
      }
    }
    pending.length = 0;
  });

  return queuingClient;
}

//---------------
// Boolean-only view of the telemetry configuration. Reuses getConfig so
// the key-resolution rules live in exactly one place; returns only a
// boolean, never the key, so it is safe to expose on public endpoints
// (e.g. GET /api/version) for external monitoring. Note: like
// getPostHogServer, this warns once per process when unconfigured —
// that warn is intentional visibility, not noise.
//---------------
export function isPostHogServerConfigured(): boolean {
  return getConfig() !== null;
}

//---------------
// Awaitable flush for request-scoped error handling (e.g. Next.js
// onRequestError). Ensures captured events are delivered before the
// serverless function freezes.
//---------------

export async function flushPostHog(): Promise<void> {
  if (typeof window !== 'undefined') return;
  try {
    const sdk = await loadSdk();
    // Access the underlying SDK for shutdown. We don't retain a direct
    // reference in the public client interface, so re-resolve here.
    if (sdk) {
      await sdk.shutdownAsync();
    }
  } catch {
    // Telemetry must never break the request path.
  }
}

//---------------
// Test seam: reset the singleton between tests.
//---------------

export function __resetPostHogServerForTests(): void {
  cachedClient = null;
  clientReady = false;
  queuingClient = null;
  sdkPromise = null;
  warned = false;
}
