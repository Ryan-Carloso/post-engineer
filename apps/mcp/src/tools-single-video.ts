// Singular MCP-first tools: generate_persona_video and validate_script.
// One call is one video, with a title and a complete segments script.
// generate_persona_video_batch (tools-batch.ts) creates several videos by
// running generatePersonaVideoOutcome once per video.
// Validation runs mechanically before the client call, so a rejected script
// never reaches the web route and never debits tokens. validate_script
// then calls POST /api/videos/validate-script, which re-runs the same
// mechanical validation server-side without debiting tokens, scheduling,
// or calling the engine or Modal. Measured hook duration is a documented
// Phase 1 gap: no hook-only TTS endpoint exists yet, so validate_script
// reports the 8-12s window and the hook word count and states that the
// measured duration is pending that endpoint — it does not invent a
// duration and does not call Modal.
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
  bodyWords: number;
  ctaWords: number;
};

function narrowValidateScriptPayload(result: unknown): ValidatedScriptPayload | string | null {
  if (typeof result !== 'object' || result === null) return null;
  const record = result as Record<string, unknown>;
  if (record.success !== true) {
    return typeof record.error === 'string' && record.error.length > 0
      ? record.error
      : 'The web validation endpoint rejected the script.';
  }
  const numbers = ['segmentCount', 'totalWords', 'hookWords', 'bodyWords', 'ctaWords'];
  for (const key of numbers) {
    if (typeof record[key] !== 'number') return null;
  }
  if (record.measured !== 'pending' || record.measuredDurationSeconds !== null) return null;
  return {
    segmentCount: record.segmentCount as number,
    totalWords: record.totalWords as number,
    hookWords: record.hookWords as number,
    bodyWords: record.bodyWords as number,
    ctaWords: record.ctaWords as number,
  };
}

export async function handleValidateScript(
  client: PostEngineerClient,
  args: ValidateScriptArgs,
): Promise<McpToolResponse> {
  // Mechanical pre-check first: a rejected script never reaches the web
  // route and never debits tokens.
  const result = validateSegments(args.segments, args.facelessMaterial);
  if (!result.ok) {
    return errorResponse(
      `Script validation failed: ${result.error.field}: ${result.error.rule} Fix: ${result.error.fix}`,
    );
  }
  let payload: ValidatedScriptPayload | string | null;
  try {
    payload = narrowValidateScriptPayload(await client.validateScript(args.segments, args.facelessMaterial));
  } catch (error) {
    return errorResponse(`Error validating the script: ${sanitizeEngineError(getErrorMessage(error))}`);
  }
  if (typeof payload === 'string') {
    return errorResponse(`Script validation failed: ${payload}`);
  }
  if (payload === null) {
    return errorResponse('Script validation failed: the web validation endpoint returned an unexpected response.');
  }
  return {
    content: [
      {
        type: 'text',
        text: [
          `Script valid: ${payload.segmentCount} segment(s), ${payload.totalWords} words total, hook ${payload.hookWords} words, body ${payload.bodyWords} words, CTA ${payload.ctaWords} words.`,
          `Hook window: ${HOOK_MIN_SECONDS}-${HOOK_MAX_SECONDS} seconds spoken (target 20-30 words).`,
          'Measured duration: pending — no hook-only TTS endpoint exists yet, so the measured hook duration cannot be checked in this phase; the hook word guard (15-40 words) already ran above.',
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

/**
 * The tool response, the ids of slots the route reported as `failed` (a 2xx
 * replay of a failed dispatch) and the created schedule id (null on error).
 */
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
    // Mechanical validation before the client call: a rejected script
    // never debits tokens and never reaches Modal.
    const material = args.options?.facelessMaterial;
    const result = validateSegments(args.segments, material);
    if (!result.ok) {
      throw new Error(`${result.error.field}: ${result.error.rule} Fix: ${result.error.fix}`);
    }
    // Full lip-sync mirrors the web route's validation, here, before any
    // client call: a rejected combination never debits tokens. The web
    // route re-validates server-side; this check is the MCP-side guard
    // so an agent gets the failure without spending anything.
    if (args.options?.fullLipsync === true && args.options?.faceless === true) {
      throw new Error('options.fullLipsync cannot be used with faceless videos: there is no face to render.');
    }
    if (args.options?.fullLipsync === true && args.personaId === undefined) {
      throw new Error('options.fullLipsync requires a persona with a photo and lip-sync enabled.');
    }
    const script = joinSegments(args.segments, material);
    // Pinterest needs exactly one board for the batch (a pin cannot exist
    // without one); the web route 400s without it, so fail fast here.
    if (args.providers.includes('pinterest') && (args.pinterestBoardId === undefined || args.pinterestBoardId.trim() === '')) {
      throw new Error('pinterestBoardId is required when pinterest is selected (list the boards with list_pinterest_boards).');
    }
    // Voice resolution is an explicit pre-step after mechanical validation
    // and before the generating call: an unknown voice fails without
    // debiting tokens. A bare name/label resolves here (issue #353); with
    // no voiceId (or options with only audioUrl) there is nothing to
    // resolve — the persona's stored voice is used.
    let voiceId = args.options?.voiceId;
    if (voiceId !== undefined) {
      voiceId = await resolvePersonaVoiceId(client, voiceId);
    }
    // The shape advertises a top-level language, but the web route only
    // reads options.language: forward it there unless options already
    // sets one, or the top-level value is silently dropped.
    const language = args.options?.language ?? args.language;
    const narrowed = narrowScheduledVideos(
      await client.generatePersonaVideo({
        personaId: args.personaId,
        title: args.title,
        providers: args.providers,
        youtubeAccountIds: args.youtubeAccountIds,
        instagramAccountIds: args.instagramAccountIds,
        linkedinAccountIds: args.linkedinAccountIds,
        blueskyAccountIds: args.blueskyAccountIds,
        threadsAccountIds: args.threadsAccountIds,
        facebookAccountIds: args.facebookAccountIds,
        pinterestAccountIds: args.pinterestAccountIds,
        pinterestBoardId: args.pinterestBoardId,
        threespeakAccountIds: args.threespeakAccountIds,
        rumbleAccountIds: args.rumbleAccountIds,
        mode,
        startAt: args.startAt,
        times: args.times,
        timezone: args.timezone,
        options: {
          ...args.options,
          voiceId,
          segments: args.segments,
          ...(language === undefined ? {} : { language }),
        },
        idempotencyKey: args.idempotencyKey,
        experiment: args.experiment,
      }),
    );
    const scheduleId = narrowed.schedule.id ?? '(unknown id)';
    const humanSummary =
      mode === 'asap'
        ? `Generating 1 video in schedule ${scheduleId}: it publishes as soon as its generation finishes (ASAP mode).`
        : `Scheduled 1 video in schedule ${scheduleId}: it is generated and auto-published at its slot.`;
    const slotLines = narrowed.slots.map(
      (slot, i) =>
        `${i + 1}. ${slot.title ?? '(untitled)'} → ${slot.slotAt ?? '(unscheduled)'} [${slot.status ?? 'unknown'}${slot.taskId ? `, task ${slot.taskId}` : ''}]`,
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
      failedSlotIds: narrowed.slots.filter((slot) => slot.status === 'failed').map((slot) => slot.slotId ?? '(unknown slot id)'),
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

function narrowScheduledVideos(result: unknown): {
  schedule: { id: string | null; mode: string | null };
  slots: Array<{ slotId: string | null; slotAt: string | null; title: string | null; taskId: string | null; status: string | null }>;
  replayed: boolean | null;
} {
  const record = typeof result === 'object' && result !== null ? (result as Record<string, unknown>) : {};
  const schedule = typeof record.schedule === 'object' && record.schedule !== null ? (record.schedule as Record<string, unknown>) : {};
  const rawSlots = Array.isArray(record.slots) ? record.slots : [];
  const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
  return {
    schedule: { id: str(schedule.id), mode: str(schedule.mode) },
    slots: rawSlots.map((slot) => {
      const s = typeof slot === 'object' && slot !== null ? (slot as Record<string, unknown>) : {};
      return { slotId: str(s.slotId), slotAt: str(s.slotAt), title: str(s.title), taskId: str(s.taskId), status: str(s.status) };
    }),
    replayed: typeof record.replayed === 'boolean' ? record.replayed : null,
  };
}

// NOTE: validate_script IS registered in index.ts (direct server.tool
// call, which the parity graph discovers) and maps to POST
// /api/videos/validate-script, which it really calls through the client
// after the local mechanical pre-check. generate_persona_video IS
// registered the same way and maps to POST
// /api/videos/generate-and-schedule.
export const ValidateScriptDescription =
  'Validate a segments script mechanically, without spending tokens: hook first, CTA last, exactly one of each, no placeholders/links/markdown/emoji/stage directions, hook terminal punctuation, word limits (total 60-200, body at least 30, CTA 5-20, hook 15-40 words before TTS). Returns the word counts and the hook window (8-12 seconds spoken). Measured hook duration is pending a hook-only TTS endpoint and is reported as pending, never invented.';

//---------------
// score_draft — mechanical draft scoring, no tokens spent.
//
// The shape mirrors the web route's body (same names, same caps); the
// handler does no local pre-check beyond the schema because every signal
// needs the server-side baseline (the caller's own stored post metrics).
// The route really is called through the client, so the parity graph
// maps score_draft to POST /api/videos/score-draft.
//---------------
const SCORE_DRAFT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ScoreDraftShape = {
  draft: z
    .string()
    .min(1, 'draft is required')
    .max(10000, 'draft must be at most 10000 characters')
    .describe('The text to score: a post body, or with kind "script" the video segments joined by newlines, hook first, CTA last.'),
  network: z
    .enum(['linkedin', 'youtube', 'instagram', 'bluesky', 'threads', 'facebook', 'pinterest', '3speak', 'rumble'])
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

export const ScoreDraftDescription =
  'Score a draft mechanically against the caller\'s own measured posts, without spending tokens. Returns a 0-100 score where every point is explained (hook, length, hashtags, slop markers, links, top-theme match, call to action), the baseline it was scored against (top angles by engagement), and the publish check for the requested network (linkedin, youtube, instagram, bluesky, threads, facebook, pinterest, 3speak, rumble): it fails only on an empty draft or the network\'s own ceiling where this repo has evidence for it (LinkedIn 3000 characters, Threads 500 characters, Facebook 63206 characters, Pinterest 800 characters, Bluesky 300 graphemes); the rest are warnings. A failing publish check means: fix the draft before scheduling it for that network. Pass kind \'script\' for a video script (segments joined by newlines, hook first, CTA last): hashtags are not scored and publishCheck is null.';

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
    // Same sanitizing error path as handleValidateScript: a thrown
    // endpoint error must never carry credential-shaped material to the
    // agent.
    return errorResponse(`Error scoring draft: ${sanitizeEngineError(getErrorMessage(error))}`);
  }
}
