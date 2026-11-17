//---------------
// experiment_video_linked — one event after generate-and-schedule commits
// a slot and the post-insert pair re-check passes. Ids and stable codes
// only. Variant names, hook text and titles never go on the event. It is
// attributed to the caller, so the experiments funnel joins it per person.
// `source` is `generate` here; attaching an existing video is a later path.
//---------------

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
