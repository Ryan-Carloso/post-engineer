import * as Sentry from "@sentry/nextjs";
import { getDeployedVersion } from "./lib/version";

//---------------
// Bugsink Cloud (Sentry-compatible) — server/edge. DSN obrigatório, sem fallback.
//---------------

export async function register() {
  // Always first: identifies the live build in every log stream, and tags
  // every error report below with the deployed version.
  console.log(`[web] starting version ${getDeployedVersion()}`);

  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  if (!dsn) {
    throw new Error(
      "NEXT_PUBLIC_SENTRY_DSN é obrigatória (Bugsink). Defina-a no .env.",
    );
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    release: getDeployedVersion(),
    tracesSampleRate: 0,
  });
}

export const onRequestError = Sentry.captureRequestError;
