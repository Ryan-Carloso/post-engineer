// Singular MCP-first tools (Phase 1): generate_persona_video and
// validate_script. The batch tool generate_persona_videos is NOT removed
// here; it is deprecated later, after the singular tool has proven itself.
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
  const result = validateSegments(args.segments);
  if (!result.ok) {
    return errorResponse(
      `Script validation failed: ${result.error.field}: ${result.error.rule} Fix: ${result.error.fix}`,
    );
  }
  let payload: ValidatedScriptPayload | string | null;
  try {
    payload = narrowValidateScriptPayload(await client.validateScript(args.segments));
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
    const result = validateSegments(args.segments);
    if (!result.ok) {
      throw new Error(`${result.error.field}: ${result.error.rule} Fix: ${result.error.fix}`);
    }
    const script = joinSegments(args.segments);
    // The shape advertises a top-level language, but the web route only
    // reads options.language: forward it there unless options already
    // sets one, or the top-level value is silently dropped.
    const language = args.options?.language ?? args.language;
    const narrowed = narrowScheduledVideos(
      await client.generatePersonaVideos({
        personaId: args.personaId,
        topics: [args.title],
        providers: args.providers,
        youtubeAccountIds: args.youtubeAccountIds,
        instagramAccountIds: args.instagramAccountIds,
        linkedinAccountIds: args.linkedinAccountIds,
        blueskyAccountIds: args.blueskyAccountIds,
        mode,
        startAt: args.startAt,
        times: args.times,
        timezone: args.timezone,
        options: {
          ...args.options,
          segments: args.segments,
          ...(language === undefined ? {} : { language }),
        },
        idempotencyKey: args.idempotencyKey,
      }),
    );
    const scheduleId = narrowed.schedule.id ?? '(unknown id)';
    const humanSummary =
      mode === 'asap'
        ? `Generating 1 video in schedule ${scheduleId}: it publishes as soon as its generation finishes (ASAP mode).`
        : `Scheduled 1 video in schedule ${scheduleId}: it is generated and auto-published at its slot.`;
    const slotLines = narrowed.slots.map(
      (slot, i) =>
        `${i + 1}. ${slot.topic ?? '(untitled)'} → ${slot.slotAt ?? '(unscheduled)'} [${slot.status ?? 'unknown'}${slot.taskId ? `, task ${slot.taskId}` : ''}]`,
    );
    return {
      content: [
        {
          type: 'text',
          text: `${humanSummary}\nScript (${countWords(script)} words):\n${script}\n${slotLines.join('\n')}\n${JSON.stringify(narrowed, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    return errorResponse(`Error generating the video: ${sanitizeEngineError(getErrorMessage(error))}`);
  }
}

function narrowScheduledVideos(result: unknown): {
  schedule: { id: string | null; mode: string | null };
  slots: Array<{ slotId: string | null; slotAt: string | null; topic: string | null; taskId: string | null; status: string | null }>;
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
      return { slotId: str(s.slotId), slotAt: str(s.slotAt), topic: str(s.topic), taskId: str(s.taskId), status: str(s.status) };
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
