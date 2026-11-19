import { trackApiEventAs } from '@/lib/analytics';

export const EXPERIMENT_VIDEO_LINKED_EVENT = 'experiment_video_linked';

export function recordExperimentVideoLinked(input: {
  userId: string;
  experimentId: string;
  variantId: string;
  pair: number;
  faceless: boolean;
  pairComplete: boolean;
}): void {
  trackApiEventAs(input.userId, EXPERIMENT_VIDEO_LINKED_EVENT, {
    experiment_id: input.experimentId,
    variant_id: input.variantId,
    pair: input.pair,
    faceless: input.faceless,
    pair_complete: input.pairComplete,
    source: 'generate',
  });
}
