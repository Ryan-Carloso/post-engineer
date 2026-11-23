import { RANGE_STATUSES } from '@/lib/contracts/schedule';
import type { SocialProvider } from '@/lib/providers/registry';

export const SHARE_POST_STATUSES = RANGE_STATUSES;
export type SharePostStatus = (typeof SHARE_POST_STATUSES)[number];

export function isSharePostStatus(value: unknown): value is SharePostStatus {
  return typeof value === 'string' && (SHARE_POST_STATUSES as readonly string[]).includes(value);
}

export interface SharePost {
  title: string | null;
  slotAt: string;
  status: SharePostStatus;
  providers: SocialProvider[];
}

export interface ShareProviderTotals {
  provider: SocialProvider;
  measurements: number;
  views: number;
  engagement: number;
}

export interface ShareSummary {
  measurements: number;
  views: number;
  engagement: number;
}

export interface ShareView {
  window: '7d';
  weekStart: string;
  weekEnd: string;
  summary: ShareSummary;
  byProvider: ShareProviderTotals[];
  asOf: string | null;
  metricsTruncated: boolean;
  posts: SharePost[];
  postsTruncated: boolean;
}

export const SHARE_POSTS_LIMIT = 100;
