import * as Sentry from "@sentry/nextjs";

//---------------
// Bugsink Cloud (Sentry-compatible) — server/edge. DSN obrigatório, sem fallback.
//---------------

export async function register() {
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
}

export const onRequestError = Sentry.captureRequestError;
