//---------------
// experiment_video_linked — one event after generate-and-schedule commits
// a slot and the post-insert pair re-check passes. Ids and stable codes
// only. Variant names, hook text and titles never go on the event.
// `source` is `generate` here; attaching an existing video is a later path.
//---------------

import { trackApiEvent } from '@/lib/analytics';

export const EXPERIMENT_VIDEO_LINKED_EVENT = 'experiment_video_linked';

export function recordExperimentVideoLinked(input: {
  experimentId: string;
  variantId: string;
  pair: number;
  faceless: boolean;
  pairComplete: boolean;
}): void {
  trackApiEvent(EXPERIMENT_VIDEO_LINKED_EVENT, {
    experiment_id: input.experimentId,
    variant_id: input.variantId,
    pair: input.pair,
    faceless: input.faceless,
    pair_complete: input.pairComplete,
    source: 'generate',
  });
}
