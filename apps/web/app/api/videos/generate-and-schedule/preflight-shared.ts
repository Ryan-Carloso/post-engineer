import type { NextResponse } from 'next/server';

import type { MediaCheckOutcome } from './media-check';

export type NarrationOutcome = number | NextResponse;

export interface PreflightShared {
  signal: AbortSignal;
  mediaChecks: Map<string, Promise<MediaCheckOutcome>>;
  narrations: Map<string, Promise<NarrationOutcome>>;
}

export function createPreflightShared(budgetMs: number): PreflightShared {
  return { signal: AbortSignal.timeout(budgetMs), mediaChecks: new Map(), narrations: new Map() };
}

export function memoize<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const pending = load();
  cache.set(key, pending);
  return pending;
}

export function withBudget(local: AbortSignal, shared: PreflightShared | undefined): AbortSignal {
  return shared === undefined ? local : AbortSignal.any([local, shared.signal]);
}
