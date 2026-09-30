import { NextResponse } from 'next/server';
import { getDeployedVersion } from '@/lib/version';

//---------------
// Public version endpoint — no auth required. Returns the platform version
// from the repo-root VERSION file (baked at build time), so anyone can
// verify which version is live (e.g. after a merge + deploy).
//---------------
export async function GET() {
  return NextResponse.json({ version: getDeployedVersion() });
}
