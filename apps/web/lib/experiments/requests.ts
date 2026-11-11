//---------------
// Request shapes for /api/experiments (issue #476). Strict: an unknown key,
// an over-length value or a blank string is a 400, never trimmed or
// dropped. Limits come from limits.ts (pinned to the database checks).
//---------------

import { z } from 'zod';

import {
  EXPERIMENT_NAME_MAX_LENGTH,
  EXPERIMENT_TARGET_PAIRS_MAX,
  EXPERIMENT_TARGET_PAIRS_MIN,
  EXPERIMENT_VARIABLES,
  EXPERIMENT_VARIANT_COUNT,
  EXPERIMENT_VARIANT_DESCRIPTION_MAX_LENGTH,
  EXPERIMENT_VARIANT_ID_PATTERN,
  EXPERIMENT_VARIANT_NAME_MAX_LENGTH,
} from './limits';
import { METRICS_WINDOWS, type MetricsWindow } from '@/lib/metrics/metrics-query';

function text(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, { message: 'must not be blank' });
}

export const CreateExperimentSchema = z
  .object({
    name: text(EXPERIMENT_NAME_MAX_LENGTH),
    variable: z.enum(EXPERIMENT_VARIABLES),
    // null / absent: a faceless experiment with no persona.
    personaId: z.string().uuid().nullable().optional(),
    targetPairs: z.number().int().min(EXPERIMENT_TARGET_PAIRS_MIN).max(EXPERIMENT_TARGET_PAIRS_MAX),
    variants: z
      .array(
        z
          .object({
            variantId: z.string().regex(EXPERIMENT_VARIANT_ID_PATTERN, 'variantId must be a lowercase slug, e.g. hook-aggressive'),
            name: text(EXPERIMENT_VARIANT_NAME_MAX_LENGTH),
            description: text(EXPERIMENT_VARIANT_DESCRIPTION_MAX_LENGTH),
          })
          .strict(),
      )
      .length(EXPERIMENT_VARIANT_COUNT)
      .refine((variants) => new Set(variants.map((variant) => variant.variantId)).size === variants.length, {
        message: 'variantId values must differ',
      }),
  })
  .strict();

export type CreateExperimentInput = z.infer<typeof CreateExperimentSchema>;

export const DEFAULT_RESULTS_WINDOW: MetricsWindow = '7d';

/** `?window=` for the results read: absent → 7d; anything unknown → error. */
export function parseResultsWindow(params: URLSearchParams): MetricsWindow | { error: string } {
  const unknown = [...params.keys()].filter((key) => key !== 'window');
  if (unknown.length > 0) return { error: 'Unknown query parameter.' };
  const raw = params.get('window');
  if (raw === null) return DEFAULT_RESULTS_WINDOW;
  const match = METRICS_WINDOWS.find((window) => window === raw);
  return match ?? { error: `window must be one of ${METRICS_WINDOWS.join(', ')}.` };
}

export interface ExperimentDetailQuery {
  window: MetricsWindow;
  /** Live provider counters instead of snapshots (issue #532). */
  live: boolean;
}

/** `?window=&live=` for the detail read: `live` is absent or `0`/`1` only. */
export function parseExperimentDetailQuery(params: URLSearchParams): ExperimentDetailQuery | { error: string } {
  const unknown = [...params.keys()].filter((key) => key !== 'window' && key !== 'live');
  if (unknown.length > 0) return { error: 'Unknown query parameter.' };
  const rawLive = params.get('live');
  if (rawLive !== null && rawLive !== '0' && rawLive !== '1') {
    return { error: 'live must be 0 or 1.' };
  }
  const windowParams = new URLSearchParams();
  const rawWindow = params.get('window');
  if (rawWindow !== null) windowParams.set('window', rawWindow);
  const window = parseResultsWindow(windowParams);
  if (typeof window !== 'string') return window;
  return { window, live: rawLive === '1' };
}
