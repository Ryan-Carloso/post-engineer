import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { applyBatchDiscount } from './client-batch.js';
import { ApiError, getErrorMessage } from './errors.js';
import { BATCH_FREE_EVERY, BATCH_KEY_MAX_LENGTH, BATCH_WINDOW_MINUTES, BATCH_KEY_PATTERN, MAX_BATCH_VIDEOS } from './limits.js';
import { GeneratePersonaVideoShape } from './single-video-shape.js';
import { sanitizeEngineError } from './tools.js';
import type { McpToolResponse } from './tools-call.js';
import { generatePersonaVideoOutcome } from './tools-single-video.js';

//---------------
// generate_persona_video_batch — the batch discount of issue #487.
//
// Creates every video of the batch with generate-and-schedule, one after
// the other, so the engine receives them back to back and renders them in
// one warm Modal container. Each video is charged its normal price at
// creation; then POST /api/videos/batch-discount groups them and credits
// back the cheapest face video of every BATCH_FREE_EVERY. The server owns
// every discount rule; this tool only reports what it answered.
//
// Idempotent: video N uses the key `batch-<batchKey>-v<N>`, so calling the
// tool again with the same batchKey and the same videos in the same order
// replays the videos already created (no second charge), creates the
// missing ones and retries the discount.
//---------------

export const BatchVideoSchema = z
  .object(GeneratePersonaVideoShape)
  .omit({ idempotencyKey: true, experiment: true, recipe: true })
  .strict();

export const GeneratePersonaVideoBatchShape = {
  batchKey: z
    .string()
    .min(1)
    .max(BATCH_KEY_MAX_LENGTH)
    .regex(BATCH_KEY_PATTERN, 'batchKey may only contain letters, digits, "-" and "_".')
    .describe(
      'A name for this batch, unique per batch (e.g. "launch-week-1"). Reuse it with the same videos in the same order to retry: created videos replay instead of being charged again.',
    ),
  videos: z
    .array(BatchVideoSchema)
    .min(2, 'A batch needs at least 2 videos')
    .max(MAX_BATCH_VIDEOS, `A batch holds at most ${MAX_BATCH_VIDEOS} videos`)
    .describe(
      `The videos, each with the same fields as generate_persona_video (no idempotencyKey, experiment or recipe). Up to ${MAX_BATCH_VIDEOS}.`,
    ),
};

export const GeneratePersonaVideoBatchSchema = z.object(GeneratePersonaVideoBatchShape);

export const GeneratePersonaVideoBatchDescription =
  `Generate and schedule a BATCH of persona videos in one call (2-${MAX_BATCH_VIDEOS}), cheaper than one by one: for every ${BATCH_FREE_EVERY} videos with the persona face in the batch, the cheapest one is free (its tokens are credited back right after creation). Faceless videos can be in the batch but pay full price, do not count toward the ${BATCH_FREE_EVERY} and are never free. Each video takes the same fields as generate_persona_video and is created and dispatched right away, one after the other, so the batch renders together. All videos must be created within ${BATCH_WINDOW_MINUTES} minutes of the first. Cancelling a video of a discounted batch (cancel_schedule) gives back the discount the batch no longer earns: it is withheld from that video's refund. If a video fails validation or creation, the videos before it stay created and discounted; fix the error and call again with the same batchKey and the same videos in the same order — created videos replay without a new charge.`;

function discountFailureText(error: unknown): string {
  const message = sanitizeEngineError(getErrorMessage(error));
  const code = error instanceof ApiError ? error.code : null;
  const next = PERMANENT_DISCOUNT_CODES.has(code ?? '')
    ? ' This batch cannot earn the discount; use a new batchKey for future videos.'
    : ' Call generate_persona_video_batch again with the same arguments to retry the discount (created videos replay without a new charge).';
  return `The batch discount could not be applied: ${message}. The videos are created and charged at full price.${next}`;
}

function textOf(response: McpToolResponse): string {
  return response.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n');
}

interface DiscountSummary {
  videos: number;
  faceVideos: number;
  earnedFreeVideos: number;
  freeVideos: number;
  discountTokens: number;
  chargedTokens: number;
  warnings: string[];
}

/** Codes a retry of the same videos can never clear. */
const PERMANENT_DISCOUNT_CODES = new Set(['BATCH_WINDOW_EXCEEDED', 'BATCH_CONFLICT', 'BATCH_TOO_LARGE']);

function narrowDiscount(result: unknown): DiscountSummary | null {
  if (typeof result !== 'object' || result === null) return null;
  const record = result as Record<string, unknown>;
  if (record.success !== true) return null;
  const numbers = ['faceVideos', 'earnedFreeVideos', 'discountTokens', 'chargedTokens'] as const;
  for (const key of numbers) {
    if (typeof record[key] !== 'number') return null;
  }
  if (!Array.isArray(record.freeVideos)) return null;
  const warnings = Array.isArray(record.warnings)
    ? record.warnings.filter((warning): warning is string => typeof warning === 'string')
    : [];
  const videos = typeof record.videos === 'number' ? record.videos : (record.faceVideos as number);
  return {
    videos,
    faceVideos: record.faceVideos as number,
    earnedFreeVideos: record.earnedFreeVideos as number,
    freeVideos: record.freeVideos.length,
    discountTokens: record.discountTokens as number,
    chargedTokens: record.chargedTokens as number,
    warnings,
  };
}

function describeDiscount(summary: DiscountSummary): string {
  const lines = [
    `Batch: ${summary.faceVideos} face video(s); ${summary.freeVideos} free (${summary.discountTokens} token(s) credited back); ${summary.chargedTokens} token(s) charged in total.`,
  ];
  const missing = BATCH_FREE_EVERY - (summary.faceVideos % BATCH_FREE_EVERY);
  // The cap is on every video in the batch, faceless included.
  if (summary.videos + missing <= MAX_BATCH_VIDEOS) {
    lines.push(`${missing} more face video(s) in this batch would make one more video free.`);
  }
  if (summary.warnings.length > 0) {
    lines.push(
      `The discount was not fully applied (${summary.warnings.join(', ')}). Call generate_persona_video_batch again with the same arguments to retry it.`,
    );
  }
  return lines.join('\n');
}

export async function handleGeneratePersonaVideoBatch(
  client: PostEngineerClient,
  args: z.infer<typeof GeneratePersonaVideoBatchSchema>,
): Promise<McpToolResponse> {
  const scheduleIds: string[] = [];
  const parts: string[] = [];
  let stoppedAt: string | null = null;
  for (const [index, video] of args.videos.entries()) {
    const { response, failedSlotIds, scheduleId } = await generatePersonaVideoOutcome(client, {
      ...video,
      idempotencyKey: `batch-${args.batchKey}-v${index + 1}`,
    });
    if (response.isError === true) {
      stoppedAt = `Video ${index + 1} of ${args.videos.length} was not created: ${textOf(response)}`;
      break;
    }
    if (scheduleId !== null) scheduleIds.push(scheduleId);
    const failed = failedSlotIds.length > 0 ? ' (its generation failed; its tokens are refunded)' : '';
    parts.push(`Video ${index + 1}${failed}:\n${textOf(response)}`);
  }

  let discountText = 'No video was created, so no batch discount applies.';
  let discountFailed = false;
  if (scheduleIds.length > 0) {
    try {
      const summary = narrowDiscount(await applyBatchDiscount(client, { batchKey: args.batchKey, scheduleIds }));
      if (summary === null) {
        discountFailed = true;
        discountText = 'The batch discount answer could not be read. Call generate_persona_video_batch again with the same arguments to retry it.';
      } else {
        discountFailed = summary.warnings.length > 0;
        discountText = describeDiscount(summary);
      }
    } catch (error) {
      discountFailed = true;
      discountText = discountFailureText(error);
    }
  }

  const header =
    stoppedAt === null
      ? `Created ${scheduleIds.length} video(s) in batch ${args.batchKey}.`
      : `Batch ${args.batchKey} stopped: ${scheduleIds.length} of ${args.videos.length} video(s) created.\n${stoppedAt}\nFix the error and call generate_persona_video_batch again with the same batchKey and the same videos in the same order: created videos replay without a new charge.`;
  return {
    content: [{ type: 'text', text: [header, discountText, ...parts].join('\n\n') }],
    ...(stoppedAt !== null || discountFailed ? { isError: true } : {}),
  };
}
