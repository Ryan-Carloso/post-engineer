// Voices contract: the single source of truth for the house voice catalog
// and the cloned-voice exchanges. Both apps generate a copy of this file
// (see scripts/sync-contracts.mjs); never edit a generated copy by hand.
//
// GET /api/persona/voices proxies the engine catalog as `{ voices }` —
// no `success` envelope. The cloned-voice routes proxy the engine's
// cloned-voices API and narrow each row to the public fields below.
//
// The two preview routes (POST /api/persona/voices/[voiceId]/preview and
// POST /api/persona/cloned-voices/[cloneId]/preview) answer with raw audio
// bytes, not JSON, so they have no response schema here: the MCP fetches
// the bytes directly. What they share is the request body — the optional
// `{ text }` JSON body, trimmed to 1-300 chars — pinned below as
// PreviewVoiceBodySchema. The 300-char cap also lives in the engine
// validator and in each web route parser (they cannot import this file);
// the four-way pin is clone-preview-text-sync.test.ts.
import { z } from 'zod';

import { defineEndpoint } from './endpoint.js';

/** House voice catalog enums (also the MCP list filter values). */
export const VOICE_GENDERS = ['female', 'male'] as const;
export const VOICE_ACCENTS = ['us', 'gb'] as const;
export const VOICE_KINDS = ['standard', 'character', 'cloned'] as const;

/** One house voice catalog entry, as the engine serves it. The id is
 * never empty (the web isVoiceOption guard requires it); gender and
 * accent are null for voices that carry none. */
export const VoiceOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().nullable(),
  provider: z.string(),
  gender: z.enum(VOICE_GENDERS).nullable(),
  accent: z.enum(VOICE_ACCENTS).nullable(),
  kind: z.enum(VOICE_KINDS),
  /** English text about how the voice sounds; null for OpenRouter and clones. */
  description: z.string().nullable(),
});

export type VoiceOption = z.infer<typeof VoiceOptionSchema>;

export const ListVoicesResponseSchema = z.object({
  voices: z.array(VoiceOptionSchema),
});

/** One cloned voice row, snake_case as the engine stores it. */
export const ClonedVoiceRowSchema = z.object({
  id: z.string(),
  status: z.string(),
  language: z.string().nullable(),
  voice_id: z.string().nullable(),
  error_code: z.string().nullable(),
  consent_at: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
});

export type ClonedVoiceRow = z.infer<typeof ClonedVoiceRowSchema>;

export const ListClonedVoicesResponseSchema = z.object({
  success: z.literal(true),
  voices: z.array(ClonedVoiceRowSchema),
});

/** The clone-create multipart fields (strings in the form). The reference
 * audio file itself is binary and has no schema; the language English-only
 * rule is enforced by the route and the tool, not here. */
export const CreateClonedVoiceBodySchema = z.object({
  consent: z.literal('true'),
  denoise: z.enum(['true', 'false']),
  language: z.string().min(1),
});

export const CreateClonedVoiceResponseSchema = z.object({
  success: z.literal(true),
  voice: ClonedVoiceRowSchema,
});

export const GetClonedVoiceResponseSchema = z.object({
  success: z.literal(true),
  voice: ClonedVoiceRowSchema,
});

export const DeleteClonedVoiceResponseSchema = z.object({
  success: z.literal(true),
});

/** Preview text cap, shared by the contract body schema, the MCP tool
 * schemas (via limits.ts) and the web route parsers. */
export const PREVIEW_TEXT_MAX_CHARS = 300;

/** The optional JSON body of both preview routes: `{ text }` only.
 * Strict: the routes 400 any other key. An absent text means the fixed
 * sample; the routes trim and require 1-300 chars when present. */
export const PreviewVoiceBodySchema = z
  .object({
    text: z.string().trim().min(1).max(PREVIEW_TEXT_MAX_CHARS).optional(),
  })
  .strict();

export const listVoices = defineEndpoint({
  method: 'GET',
  path: '/api/persona/voices',
  response: ListVoicesResponseSchema,
});

export const listClonedVoices = defineEndpoint({
  method: 'GET',
  path: '/api/persona/cloned-voices',
  response: ListClonedVoicesResponseSchema,
});

export const createClonedVoice = defineEndpoint({
  method: 'POST',
  path: '/api/persona/cloned-voices',
  body: CreateClonedVoiceBodySchema,
  response: CreateClonedVoiceResponseSchema,
});

export const getClonedVoice = defineEndpoint({
  method: 'GET',
  path: '/api/persona/cloned-voices/:cloneId',
  response: GetClonedVoiceResponseSchema,
});

export const deleteClonedVoice = defineEndpoint({
  method: 'DELETE',
  path: '/api/persona/cloned-voices/:cloneId',
  response: DeleteClonedVoiceResponseSchema,
});
