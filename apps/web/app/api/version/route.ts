import { NextResponse } from 'next/server';
import { getDeployedVersion } from '@/lib/version';

//---------------
// Public version endpoint — no auth required. Returns the deployed git SHA
// so anyone can verify which commit is live (e.g. after a merge + deploy).
// A SHA is not sensitive: the repository is public.
//---------------
export async function GET() {
  return NextResponse.json({ version: getDeployedVersion() });
}
