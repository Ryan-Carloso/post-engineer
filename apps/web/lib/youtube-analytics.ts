import 'server-only';

import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { logger } from '@/lib/logger';
import { httpStatusOf } from '@/lib/upload/account-unauthorized';

//---------------
// YouTube Analytics API v2 for the owner's own videos. Every query uses
// ids=channel==MINE with the account's own OAuth token, so YouTube itself
// only answers for the authorizing user's channel; callers also check the
// video belongs to that channel before querying (provider-counters,
// retention-curve route).
//
// Errors:
//   403 insufficient scopes  -> { kind: 'scope_missing' } (token predates
//                               yt-analytics.readonly: the user reconnects)
//   any other 401/403        -> AnalyticsAuthError (config error, logged at
//                               error, never retried as transient)
//   everything else          -> rethrown (5xx/429/abort: the caller retries)
//---------------

export interface VideoAnalyticsStats {
  views: number;
  engagedViews: number;
  averageViewDurationSeconds: number | null;
  averageViewPercentage: number | null;
  // Raw creatorContentType of the row with the most views (SHORTS,
  // VIDEO_ON_DEMAND, LIVE_STREAM, STORY, UNSPECIFIED).
  contentType: string | null;
}

export type VideoStatsResult =
  | { kind: 'ok'; stats: VideoAnalyticsStats }
  | { kind: 'no_data' }
  | { kind: 'scope_missing' };

export interface RetentionPoint {
  // elapsedVideoTimeRatio: exclusive end of the interval, 0.01..1.0.
  ratio: number;
  audienceWatchRatio: number;
  relativeRetentionPerformance: number | null;
}

export type RetentionCurveResult = { kind: 'ok'; points: RetentionPoint[] } | { kind: 'scope_missing' };

export interface AnalyticsRange {
  videoId: string;
  // YYYY-MM-DD, inclusive.
  startDate: string;
  endDate: string;
}

export class AnalyticsAuthError extends Error {
  constructor(public readonly status: number) {
    super(`YouTube Analytics rejected the token (${status})`);
    this.name = 'AnalyticsAuthError';
  }
}

export function analyticsDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Video ids are [A-Za-z0-9_-]; anything else must never reach the filter string.
export const VIDEO_ID = /^[A-Za-z0-9_-]{1,64}$/;

// The snippet of a Data API videos.list item ({} when absent): channelId
// (ownership) and publishedAt (report start date).
export function videoSnippet(videoInfo: unknown): Record<string, unknown> {
  const snippet = readRecord(videoInfo, 'snippet');
  return typeof snippet === 'object' && snippet !== null ? (snippet as Record<string, unknown>) : {};
}

function readRecord(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function collectReasons(error: unknown): string[] {
  const reasons: string[] = [];
  const apiError = readRecord(readRecord(readRecord(error, 'response'), 'data'), 'error');
  for (const list of [readRecord(error, 'errors'), readRecord(apiError, 'errors'), readRecord(apiError, 'details')]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const reason = readRecord(item, 'reason');
      if (typeof reason === 'string') reasons.push(reason);
    }
  }
  return reasons;
}

export function isInsufficientScopeError(error: unknown): boolean {
  if (httpStatusOf(error) !== 403) return false;
  const reasons = collectReasons(error);
  if (reasons.includes('insufficientPermissions') || reasons.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) return true;
  return error instanceof Error && /insufficient authentication scopes/i.test(error.message);
}

async function runQuery(client: OAuth2Client, params: Record<string, string>): Promise<unknown> {
  // googleapis bundles its own google-auth-library type, hence the cast on
  // auth only (same as getYouTubeClient); `version: 'v2'` picks the v2 types.
  const analytics = google.youtubeAnalytics({ version: 'v2', auth: client as never });
  const response = await analytics.reports.query({ ids: 'channel==MINE', ...params });
  return response.data;
}

type Table = Array<Record<string, unknown>>;

// The report as one object per row, keyed by column name.
export function reportTable(data: unknown): Table {
  const headers = readRecord(data, 'columnHeaders');
  const rows = readRecord(data, 'rows');
  if (!Array.isArray(headers) || !Array.isArray(rows)) return [];
  const names = headers.map((header) => readRecord(header, 'name'));
  const table: Table = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const entry: Record<string, unknown> = {};
    names.forEach((name, index) => {
      if (typeof name === 'string') entry[name] = row[index];
    });
    table.push(entry);
  }
  return table;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Rows split by creatorContentType: counts are summed, averages weighted by
// views, and the content type is the one with the most views.
export function aggregateVideoStats(table: Table): VideoAnalyticsStats | null {
  let views = 0;
  let engagedViews = 0;
  let durationWeighted = 0;
  let percentWeighted = 0;
  let durationWeight = 0;
  let percentWeight = 0;
  let topViews = -1;
  let contentType: string | null = null;
  for (const row of table) {
    const rowViews = num(row.views);
    const rowEngaged = num(row.engagedViews);
    if (rowViews === null || rowEngaged === null) continue;
    views += rowViews;
    engagedViews += rowEngaged;
    const duration = num(row.averageViewDuration);
    if (duration !== null) {
      durationWeighted += duration * rowViews;
      durationWeight += rowViews;
    }
    const percent = num(row.averageViewPercentage);
    if (percent !== null) {
      percentWeighted += percent * rowViews;
      percentWeight += rowViews;
    }
    if (rowViews > topViews) {
      topViews = rowViews;
      contentType = typeof row.creatorContentType === 'string' ? row.creatorContentType : null;
    }
  }
  if (topViews < 0) return null;
  return {
    views,
    engagedViews,
    averageViewDurationSeconds: durationWeight > 0 ? Math.round((durationWeighted / durationWeight) * 10) / 10 : null,
    averageViewPercentage: percentWeight > 0 ? Math.round((percentWeighted / percentWeight) * 10) / 10 : null,
    contentType,
  };
}

function classify(error: unknown, label: string): { kind: 'scope_missing' } {
  if (isInsufficientScopeError(error)) return { kind: 'scope_missing' };
  const status = httpStatusOf(error);
  if (status === 401 || status === 403) {
    logger.error(`[youtube-analytics] ${label} rejected`, { status });
    throw new AnalyticsAuthError(status);
  }
  throw error;
}

function assertRange(range: AnalyticsRange): void {
  if (!VIDEO_ID.test(range.videoId)) throw new Error('Invalid YouTube video id');
}

export async function queryVideoStats(client: OAuth2Client, range: AnalyticsRange): Promise<VideoStatsResult> {
  assertRange(range);
  let data: unknown;
  try {
    data = await runQuery(client, {
      startDate: range.startDate,
      endDate: range.endDate,
      metrics: 'views,engagedViews,averageViewDuration,averageViewPercentage',
      dimensions: 'creatorContentType',
      filters: `video==${range.videoId}`,
    });
  } catch (error) {
    return classify(error, 'video stats');
  }
  const stats = aggregateVideoStats(reportTable(data));
  return stats === null ? { kind: 'no_data' } : { kind: 'ok', stats };
}

export async function queryRetentionCurve(client: OAuth2Client, range: AnalyticsRange): Promise<RetentionCurveResult> {
  assertRange(range);
  let data: unknown;
  try {
    data = await runQuery(client, {
      startDate: range.startDate,
      endDate: range.endDate,
      metrics: 'audienceWatchRatio,relativeRetentionPerformance',
      dimensions: 'elapsedVideoTimeRatio',
      filters: `video==${range.videoId}`,
    });
  } catch (error) {
    return classify(error, 'retention curve');
  }
  const points: RetentionPoint[] = [];
  for (const row of reportTable(data)) {
    const ratio = num(row.elapsedVideoTimeRatio);
    const watch = num(row.audienceWatchRatio);
    if (ratio === null || watch === null) continue;
    points.push({ ratio, audienceWatchRatio: watch, relativeRetentionPerformance: num(row.relativeRetentionPerformance) });
  }
  points.sort((a, b) => a.ratio - b.ratio);
  return { kind: 'ok', points };
}
