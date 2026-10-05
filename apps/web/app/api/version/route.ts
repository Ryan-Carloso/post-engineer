import { NextResponse } from 'next/server';
import { getDeployedVersion } from '@/lib/version';
import { withApiErrorReporting } from '@/lib/api-error-reporting';

//---------------
// Public version endpoint — no auth required. Returns the platform version
// from the repo-root VERSION file (baked at build time), so anyone can
// verify which version is live (e.g. after a merge + deploy).
//---------------
async function getHandler() {
  return NextResponse.json({ version: getDeployedVersion() });
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/version', getHandler);
