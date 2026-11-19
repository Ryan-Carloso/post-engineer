import { NextResponse } from 'next/server';
import { withApiErrorReporting } from '@/lib/api-error-reporting';

export const dynamic = 'force-dynamic';

type ServerCoverageMap = Record<string, unknown>;

declare global {
  var __coverage__: ServerCoverageMap | undefined;
}

async function getHandler() {
  const coverage = globalThis.__coverage__;
  if (!coverage) {
    return new NextResponse(null, { status: 204 });
  }
  return NextResponse.json({ coverage });
}

export const GET = withApiErrorReporting('GET /api/coverage', getHandler);
