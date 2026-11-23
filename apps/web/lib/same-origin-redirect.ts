import { NextResponse } from 'next/server';
import { isSafeNextPath } from '@/lib/safe-next-path';

export function sameOriginRedirect(path: string, status: 302 | 307 = 307): NextResponse {
  if (!isSafeNextPath(path)) {
    throw new Error('sameOriginRedirect needs a same-origin absolute path');
  }
  return new NextResponse(null, { status, headers: { Location: path } });
}
