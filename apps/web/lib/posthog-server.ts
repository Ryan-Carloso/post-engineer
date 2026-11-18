// posthog-node is loaded via a dynamic import marked `webpackIgnore: true`

import { resolveHost } from './posthog-config';

const SERVER_DISTINCT_ID = 'post-engineer-server';

// `webpackIgnore: true` so webpack does not try to bundle the Node-only

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
  if (typeof window !== 'undefined') return null;
  const key = process.env.POSTHOG_API_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    warnOnce('[posthog] POSTHOG_API_KEY / NEXT_PUBLIC_POSTHOG_KEY not set — PostHog telemetry disabled');
    return null;
  }
  return {
    key,
    host: resolveHost(process.env.NEXT_PUBLIC_POSTHOG_HOST, warnOnce),
  };
}

function loadSdk(): Promise<PostHogNodeClient | null> {
  if (!sdkPromise) {
    sdkPromise = (async (): Promise<PostHogNodeClient | null> => {
      const config = getConfig();
      if (!config) return null;
      try {
        // webpackIgnore: true is load-bearing — without it, webpack
        const { PostHog } = await import(/* webpackIgnore: true */ 'posthog-node');
        return new PostHog(config.key, {
          host: config.host,
        }) as unknown as PostHogNodeClient;
      } catch (error: unknown) {
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

export interface ServerPostHogClient {
  capture(event: string, properties?: Record<string, unknown>): void;
  captureAs(distinctId: string, event: string, properties?: Record<string, unknown>): void;
  captureException(error: unknown, properties?: Record<string, unknown>): void;
  captureExceptionAs(distinctId: string, error: unknown, properties?: Record<string, unknown>): void;
}

export type TelemetryEnvironment = 'production' | 'development';

export function getTelemetryEnvironment(): TelemetryEnvironment {
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

const TELEMETRY_SOURCE = 'web-server';

function withOriginTags(properties?: Record<string, unknown>): Record<string, unknown> {
  return { ...properties, source: TELEMETRY_SOURCE, environment: getTelemetryEnvironment() };
}

function toClient(sdk: PostHogNodeClient): ServerPostHogClient {
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
    captureExceptionAs: (distinctId, error, properties) => {
      captureAndFlush(() =>
        sdk.captureException(error, distinctId, withOriginTags(properties)),
      );
    },
  };
}

let cachedClient: ServerPostHogClient | null = null;
let clientReady = false;
let queuingClient: ServerPostHogClient | null = null;

export function getPostHogServer(): ServerPostHogClient | null {
  if (typeof window !== 'undefined') return null;
  if (clientReady) return cachedClient;

  if (!getConfig()) return null;

  if (queuingClient) return queuingClient;

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
    captureExceptionAs: (distinctId, error, properties) => {
      pending.push(() => cachedClient?.captureExceptionAs(distinctId, error, properties));
    },
  };

  loadSdk().then((sdk) => {
    if (sdk) {
      cachedClient = toClient(sdk);
    }
    clientReady = true;
    for (const send of pending) {
      try {
        send();
      } catch {
      }
    }
    pending.length = 0;
  });

  return queuingClient;
}

export function isPostHogServerConfigured(): boolean {
  return getConfig() !== null;
}

export async function flushPostHog(): Promise<void> {
  if (typeof window !== 'undefined') return;
  try {
    const sdk = await loadSdk();
    if (sdk) {
      await sdk.shutdownAsync();
    }
  } catch {
  }
}

export function __resetPostHogServerForTests(): void {
  cachedClient = null;
  clientReady = false;
  queuingClient = null;
  sdkPromise = null;
  warned = false;
}
