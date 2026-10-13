import { NextResponse } from 'next/server';
import { withApiErrorReporting } from '@/lib/api-error-reporting';

// DEMO ONLY — never merge. This endpoint exists solely to prove the
// Web -> MCP parity check fails on a new endpoint without MCP coverage
// (validation PR). It has no product purpose and no MCP mapping.
async function getHandler() {
  return NextResponse.json({ ok: true });
}

export const GET = withApiErrorReporting('GET /api/parity-demo', getHandler);
