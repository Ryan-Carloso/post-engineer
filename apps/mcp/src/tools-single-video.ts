import { z } from 'zod';
import type { PostEngineerClient } from './client.js';
import { scoreDraft } from './client-posts.js';
import { getErrorMessage } from './errors.js';
import { sanitizeEngineError } from './tools.js';
import type { McpToolResponse } from './tools-call.js';
import {
  HOOK_MAX_SECONDS,
  HOOK_MIN_SECONDS,
  countWords,
  joinSegments,
  validateSegments,
} from './script-segments.js';
import { GeneratePersonaVideoSchema, ValidateScriptSchema } from './single-video-shape.js';
import { resolvePersonaVoiceId } from './voice-filters.js';
import { PUBLISH_NETWORKS } from './contracts/videos.js';
import { checkHookTitle, hookTitleIssueMessage } from './hook-title.js';

export { GeneratePersonaVideoShape, ValidateScriptShape } from './single-video-shape.js';

type GeneratePersonaVideoArgs = z.infer<typeof GeneratePersonaVideoSchema>;
type ValidateScriptArgs = z.infer<typeof ValidateScriptSchema>;

function errorResponse(message: string): McpToolResponse {
  return { content: [{ type: 'text', text: message }], isError: true };
}

type ValidatedScriptPayload = {
  segmentCount: number;
  totalWords: number;
  hookWords: number;
  contentWords: number;
};

export async function handleValidateScript(
  client: PostEngineerClient,
  args: ValidateScriptArgs,
): Promise<McpToolResponse> {
  const result = validateSegments(args.segments, args.videoType ?? 'hook_lipsync');
  if (!result.ok) {
    return errorResponse(
      `Script validation failed: ${result.error.field}: ${result.error.rule} Fix: ${result.error.fix}`,
    );
  }
  const hookTitleCode = args.hookTitle === undefined ? null : checkHookTitle(args.hookTitle);
  if (hookTitleCode !== null) {
    return errorResponse(`Script validation failed: hookTitle: ${hookTitleIssueMessage(hookTitleCode)}`);
  }
  let payload: ValidatedScriptPayload;
  try {
    const result = await client.validateScript(args.segments, args.videoType ?? 'hook_lipsync', args.hookTitle);
    payload = {
      segmentCount: result.segmentCount,
      totalWords: result.totalWords,
      hookWords: result.hookWords,
      contentWords: result.contentWords,
    };
  } catch (error) {
    return errorResponse(`Error validating the script: ${sanitizeEngineError(getErrorMessage(error))}`);
  }
  return {
    content: [
      {
        type: 'text',
        text: [
          `Script valid: ${payload.segmentCount} segment(s), ${payload.totalWords} words total, hook ${payload.hookWords} words, content ${payload.contentWords} words.`,
          `Hook window: ${HOOK_MIN_SECONDS}-${HOOK_MAX_SECONDS} seconds spoken (target 25-35 words).`,
          'Measured duration: pending — no hook-only TTS endpoint exists yet, so the measured hook duration cannot be checked in this phase; the hook word guard (25-40 words) already ran above.',
        ].join('\n'),
      },
    ],
  };
}

export async function handleGeneratePersonaVideo(
  client: PostEngineerClient,
  args: GeneratePersonaVideoArgs,
): Promise<McpToolResponse> {
  return (await generatePersonaVideoOutcome(client, args)).response;
}

export async function generatePersonaVideoOutcome(
  client: PostEngineerClient,
  args: GeneratePersonaVideoArgs,
): Promise<{ response: McpToolResponse; failedSlotIds: string[]; scheduleId: string | null }> {
  try {
    const mode = args.mode ?? 'scheduled';
    if (mode === 'asap' && (args.startAt !== undefined || args.times !== undefined)) {
      throw new Error("startAt and times must not be set when mode is 'asap'.");
    }
    if (mode === 'scheduled' && (args.startAt === undefined || args.times === undefined)) {
      throw new Error("startAt and times are required when mode is 'scheduled'.");
    }
    const videoType = args.options?.videoType ?? 'hook_lipsync';
    const result = validateSegments(args.segments, videoType);
    if (!result.ok) {
      throw new Error(`${result.error.field}: ${result.error.rule} Fix: ${result.error.fix}`);
    }
    if (args.personaId === undefined && videoType !== 'voiceover') {
      throw new Error('A post without a persona must be voiceover: set options.videoType to \'voiceover\'.');
    }
    if (args.personaId === undefined && args.options?.voiceId === undefined && args.options?.audioUrl === undefined) {
      throw new Error('A post without a persona must have a voice: set options.voiceId (or options.audioUrl).');
    }
    const script = joinSegments(args.segments, videoType);
    if (args.providers.includes('pinterest') && (args.pinterestBoardId === undefined || args.pinterestBoardId.trim() === '')) {
      throw new Error('pinterestBoardId is required when pinterest is selected (list the boards with accounts (action: list_boards)).');
    }
    let voiceId = args.options?.voiceId;
    if (voiceId !== undefined) {
      voiceId = await resolvePersonaVoiceId(client, voiceId);
    }
    const language = args.options?.language ?? args.language;
    const narrowed = await client.generatePersonaVideo({
        personaId: args.personaId,
        title: args.title,
        description: args.description,
        providers: args.providers,
        youtubeAccountIds: args.youtubeAccountIds,
        instagramAccountIds: args.instagramAccountIds,
        linkedinAccountIds: args.linkedinAccountIds,
        blueskyAccountIds: args.blueskyAccountIds,
        threadsAccountIds: args.threadsAccountIds,
        facebookAccountIds: args.facebookAccountIds,
        pinterestAccountIds: args.pinterestAccountIds,
        pinterestBoardId: args.pinterestBoardId,
        fanvueAccountIds: args.fanvueAccountIds,
        threespeakAccountIds: args.threespeakAccountIds,
        rumbleAccountIds: args.rumbleAccountIds,
        telegramAccountIds: args.telegramAccountIds,
        mode,
        startAt: args.startAt,
        times: args.times,
        timezone: args.timezone,
        options: {
          ...args.options,
          videoType,
          voiceId,
          segments: args.segments,
          ...(language === undefined ? {} : { language }),
        },
        idempotencyKey: args.idempotencyKey,
        promptVersionId: args.promptVersionId,
        cta: args.cta,
      });
    const scheduleId = narrowed.schedule.id;
    const humanSummary =
      mode === 'asap'
        ? `Generating 1 video in schedule ${scheduleId}: it publishes as soon as its generation finishes (ASAP mode).`
        : `Scheduled 1 video in schedule ${scheduleId}: it is generated and auto-published at its slot.`;
    const slotLines = narrowed.slots.map(
      (slot, i) =>
        `${i + 1}. ${slot.title} → ${slot.slotAt} [${slot.status}${slot.taskId ? `, task ${slot.taskId}` : ''}]`,
    );
    return {
      response: {
        content: [
          {
            type: 'text',
            text: `${humanSummary}\nScript (${countWords(script)} words):\n${script}\n${slotLines.join('\n')}\n${JSON.stringify(narrowed, null, 2)}`,
          },
        ],
      },
      failedSlotIds: narrowed.slots.filter((slot) => slot.status === 'failed').map((slot) => slot.slotId),
      scheduleId: narrowed.schedule.id,
    };
  } catch (error) {
    return {
      response: errorResponse(`Error generating the video: ${sanitizeEngineError(getErrorMessage(error))}`),
      failedSlotIds: [],
      scheduleId: null,
    };
  }
}

const SCORE_DRAFT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ScoreDraftShape = {
  draft: z
    .string()
    .min(1, 'draft is required')
    .max(10000, 'draft must be at most 10000 characters')
    .describe('The text to score: a post body, or with kind "script" the video segments joined by newlines, hook first, then content takes.'),
  network: z
    .enum(PUBLISH_NETWORKS)
    .optional()
    .describe('Network the draft is for; the publish check uses that network\'s rules. Defaults to linkedin.'),
  personaId: z
    .string()
    .refine((value) => SCORE_DRAFT_UUID.test(value), { message: 'personaId must be a uuid' })
    .optional()
    .describe('Optional persona id: score against that persona\'s measured posts only.'),
  kind: z.enum(['post', 'script']).optional().describe('What the text is. Defaults to post.'),
};

export const ScoreDraftSchema = z.object(ScoreDraftShape);

export async function handleScoreDraft(
  client: PostEngineerClient,
  args: z.infer<typeof ScoreDraftSchema>,
): Promise<McpToolResponse> {
  try {
    const result = await scoreDraft(client, {
      draft: args.draft,
      network: args.network,
      personaId: args.personaId,
      kind: args.kind,
    });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return errorResponse(`Error scoring draft: ${sanitizeEngineError(getErrorMessage(error))}`);
  }
}
