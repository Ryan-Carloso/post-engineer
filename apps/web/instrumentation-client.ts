import * as Sentry from "@sentry/nextjs";

//---------------
// Bugsink Cloud (Sentry-compatible) — client/browser. DSN obrigatório, sem fallback.
//---------------

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (!dsn) {
  throw new Error(
    "NEXT_PUBLIC_SENTRY_DSN é obrigatória (Bugsink). Defina-a no .env.",
  );
}

Sentry.init({
  dsn,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
