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
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST;
  return { key, host };
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
        return new PostHog(config.key, {
          host: config.host,
          // Serverless (Vercel): best-effort immediate flush. flushAt: 1
          // starts an async flush on every capture, but the function can
          // freeze after the response before the network write lands.
          flushAt: 1,
        }) as unknown as PostHogNodeClient;
      } catch {
        warnOnce('[posthog] Failed to initialize PostHog client — telemetry disabled');
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

function toClient(sdk: PostHogNodeClient): ServerPostHogClient {
  return {
    capture: (event, properties) => {
      sdk.capture({ distinctId: SERVER_DISTINCT_ID, event, properties });
    },
    captureAs: (distinctId, event, properties) => {
      sdk.capture({ distinctId, event, properties });
    },
    captureException: (error, properties) => {
      sdk.captureException(error, SERVER_DISTINCT_ID, properties);
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
