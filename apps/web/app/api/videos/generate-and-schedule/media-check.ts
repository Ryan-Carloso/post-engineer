import { NextResponse } from 'next/server';

import { ERROR_CODES } from '@/lib/error-codes';
import type { SegmentMediaRef } from '@/lib/hook-photo';
import { engineAuthHeaders } from '@/lib/request-auth';
import { logger } from '@/lib/logger';
import { coded } from './prepare-persona';

export const MEDIA_CHECK_TIMEOUT_MS = 30_000;

export type VideoAspectOption = '9:16' | '16:9' | '1:1';

export interface MediaCheckRecord {
  code?: unknown;
  width?: unknown;
  height?: unknown;
  has_face?: unknown;
}

export async function fetchMediaCheck(
  ref: SegmentMediaRef,
  userId: string,
  videoAspect: VideoAspectOption,
  logTag: string,
): Promise<(MediaCheckRecord & { code: string }) | NextResponse> {
  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl || !process.env.MONEYPRINT_API_SECRET) {
    logger.error(`[${logTag}] engine URL or secret is not defined`);
    return coded(502, ERROR_CODES.INTERNAL_ERROR, 'Video service is unavailable.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MEDIA_CHECK_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/media/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...engineAuthHeaders(userId),
      },
      body: JSON.stringify(
        ref.mediaId !== undefined
          ? { media_id: ref.mediaId, video_aspect: videoAspect }
          : { url: ref.url, video_aspect: videoAspect },
      ),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    logger.error(`[${logTag}] engine unreachable`, error);
    return coded(502, ERROR_CODES.INTERNAL_ERROR, 'Video service is unavailable.');
  }
  clearTimeout(timeout);
  if (!upstream.ok) {
    logger.error(`[${logTag}] engine check failed`, undefined, {
      status: upstream.status,
    });
    return coded(502, ERROR_CODES.INTERNAL_ERROR, 'Video service is unavailable.');
  }
  const parsed: unknown = await upstream.json().catch(() => null);
  const body = (parsed as { body?: unknown } | null)?.body;
  const record = (
    typeof body === 'object' && body !== null ? body : {}
  ) as MediaCheckRecord;
  if (typeof record.code !== 'string') {
    logger.error(`[${logTag}] engine check returned no code`);
    return coded(502, ERROR_CODES.INTERNAL_ERROR, 'Video service is unavailable.');
  }
  return { ...record, code: record.code };
}

