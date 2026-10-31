//---------------
// persona-voice — the single voiceId gate for create_persona, update_persona
// and generate_persona_video options.voiceId (issue #353).
//
// Agents pass a house voice NAME or LABEL from list_voices ('phonon_zoey',
// 'Zoey') — never a provider prefix. All 65 house names are exposed as a
// JSON-schema enum so MCP UIs can autocomplete them. resolvePersonaVoiceId
// runs before any mutating client call (createPersona, updatePersona,
// generatePersonaVideo): an unknown voice never reaches the web route and
// never debits tokens. Clones are copied verbatim from list_voices: prod
// clones have label null and serve `chatterbox_nano:<key>` ids.
//---------------

import { z } from 'zod';
import type { PostEngineerClient } from './client.js';

export interface HouseVoice {
  readonly name: string;
  readonly label: string;
}

// GENERATED — begin (node gen-house-voices.mjs). Do not hand-edit:
// regenerate from the engine catalog or the sync test will fail.
export const HOUSE_VOICES: readonly HouseVoice[] = [
  { name: "phonon_zoey", label: "Zoey" },
  { name: "phonon_juniper", label: "Juniper" },
  { name: "phonon_everly", label: "Everly" },
  { name: "phonon_harper", label: "Harper" },
  { name: "phonon_hadley", label: "Hadley" },
  { name: "phonon_delia", label: "Delia" },
  { name: "phonon_easton", label: "Easton" },
  { name: "phonon_micah", label: "Micah" },
  { name: "phonon_trevor", label: "Trevor" },
  { name: "phonon_russell", label: "Russell" },
  { name: "phonon_preston", label: "Preston" },
  { name: "phonon_miles", label: "Miles" },
  { name: "phonon_maeve", label: "Maeve" },
  { name: "phonon_freya", label: "Freya" },
  { name: "phonon_pippa", label: "Pippa" },
  { name: "phonon_elodie_rose", label: "Elodie-Rose" },
  { name: "phonon_imogen", label: "Imogen" },
  { name: "phonon_lottie", label: "Lottie" },
  { name: "phonon_alfie", label: "Alfie" },
  { name: "phonon_hugh", label: "Hugh" },
  { name: "phonon_edwin", label: "Edwin" },
  { name: "phonon_spencer", label: "Spencer" },
  { name: "phonon_toby", label: "Toby" },
  { name: "phonon_teddy", label: "Teddy" },
  { name: "phonon_bryony", label: "Bryony" },
  { name: "phonon_captain_silas_blackwater", label: "Captain Silas Blackwater" },
  { name: "phonon_morwenna_of_the_deep", label: "Morwenna of the Deep" },
  { name: "phonon_old_mortlake", label: "Old Mortlake" },
  { name: "phonon_azgorath", label: "Azgorath" },
  { name: "phonon_fennick_the_young_elf", label: "Fennick the Young Elf" },
  { name: "phonon_the_thing_under_the_stairs", label: "The Thing Under the Stairs" },
  { name: "phonon_vyrmathrax_the_ancient", label: "Vyrmathrax the Ancient" },
  { name: "phonon_grub_the_ogre", label: "Grub the Ogre" },
  { name: "phonon_master_aldric", label: "Master Aldric" },
  { name: "phonon_the_snow_queen", label: "The Snow Queen" },
  { name: "phonon_sir_bramwell", label: "Sir Bramwell" },
  { name: "phonon_fairy_godmother", label: "Fairy Godmother" },
  { name: "kokoro_af_heart", label: "Heart" },
  { name: "kokoro_af_alloy", label: "Alloy" },
  { name: "kokoro_af_aoede", label: "Aoede" },
  { name: "kokoro_af_bella", label: "Bella" },
  { name: "kokoro_af_jessica", label: "Jessica" },
  { name: "kokoro_af_kore", label: "Kore" },
  { name: "kokoro_af_nicole", label: "Nicole" },
  { name: "kokoro_af_nova", label: "Nova" },
  { name: "kokoro_af_river", label: "River" },
  { name: "kokoro_af_sarah", label: "Sarah" },
  { name: "kokoro_af_sky", label: "Sky" },
  { name: "kokoro_am_adam", label: "Adam" },
  { name: "kokoro_am_echo", label: "Echo" },
  { name: "kokoro_am_eric", label: "Eric" },
  { name: "kokoro_am_fenrir", label: "Fenrir" },
  { name: "kokoro_am_liam", label: "Liam" },
  { name: "kokoro_am_michael", label: "Michael" },
  { name: "kokoro_am_onyx", label: "Onyx" },
  { name: "kokoro_am_puck", label: "Puck" },
  { name: "kokoro_am_santa", label: "Santa" },
  { name: "kokoro_bf_alice", label: "Alice" },
  { name: "kokoro_bf_emma", label: "Emma" },
  { name: "kokoro_bf_isabella", label: "Isabella" },
  { name: "kokoro_bf_lily", label: "Lily" },
  { name: "kokoro_bm_daniel", label: "Daniel" },
  { name: "kokoro_bm_fable", label: "Fable" },
  { name: "kokoro_bm_george", label: "George" },
  { name: "kokoro_bm_lewis", label: "Lewis" },
];
// GENERATED — end

export const NO_VOICE_SENTINELS = ['no-voice', 'none'] as const;

// Voice ids the engine routes itself, passed through verbatim:
// no-voice/none (explicit silence), plus any bare clone id or key that
// list_voices confirms.
export function personaVoiceField(requiredMessage?: string) {
  // 65 house names + idle no-voice/none sentinels: z.enum needs a non-empty
  // tuple, and the catalog is guaranteed non-empty (sync test).
  const houseNames = HOUSE_VOICES.map((voice) => voice.name);
  const names = [
    houseNames[0] ?? '',
    ...houseNames.slice(1),
    ...NO_VOICE_SENTINELS,
  ] as [string, ...string[]];
  const field = z.union([z.enum(names), z.string()]).superRefine((value, ctx) => {
    if (typeof value === 'string' && value.trim().length > 0) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: requiredMessage ?? 'voiceId must be a non-empty string',
    });
  });
  // The description is placed on the refined wrapper: MCP UIs read it,
  // and the union keeps the house-name enum for autocomplete.
  return field.describe(
    'id or label from list_voices. Never type a provider prefix.',
  );
}

/** resolvePersonaVoiceId — resolves any accepted voiceId spelling to the
 *  exact id the web route stores, BEFORE any mutating call.
 *  1. undefined / '' → undefined (update keeps the stored voice);
 *  2. 'no-voice' / 'none' → pass through, zero HTTP;
 *  3. house name, label or `chatterbox:<name>` (case-insensitive) →
 *     `chatterbox:<name>`, zero HTTP;
 *  4. anything else → consult client.listVoices() (a GET) and match
 *     `cloned` entries by full id, key without prefix, the old
 *     `chatterbox:<key>` spelling, or label. Unknown / ambiguous → the
 *     exact Unknown-voice error below. A listVoices failure propagates
 *     with its real message (never the Unknown-voice error). */
export const UNKNOWN_VOICE_MESSAGE =
  'Unknown voice. Call list_voices and pass the id or label from that list (house voices and your clones).';

function throwUnknownVoice(): never {
  throw new Error(UNKNOWN_VOICE_MESSAGE);
}

function houseMatch(voiceId: string): string | null {
  const lowered = voiceId.trim().toLowerCase();
  if (lowered.length === 0) return null;
  for (const voice of HOUSE_VOICES) {
    const name = voice.name.toLowerCase();
    const label = voice.label.toLowerCase();
    if (lowered === name || lowered === label || lowered === `chatterbox:${name}`) {
      return `chatterbox:${voice.name}`;
    }
  }
  return null;
}

function cloneMatches(voiceId: string, entry: { id?: unknown; label?: unknown }): boolean {
  if (typeof entry.id !== 'string') return false;
  const lowered = voiceId.trim().toLowerCase();
  const id = entry.id.toLowerCase();
  if (lowered === id) return true;
  const key = id.replace(/^chatterbox(?:_nano)?:/, '');
  if (key.length === 0 || key === id) return false;
  if (lowered === key) return true;
  if (lowered === `chatterbox:${key}`) return true;
  return typeof entry.label === 'string' && lowered === entry.label.toLowerCase();
}

function voiceEntries(payload: unknown): Array<{ id?: unknown; label?: unknown; kind?: unknown }> {
  if (typeof payload !== 'object' || payload === null || !('voices' in payload)) {
    throw new Error('Invalid voices response: expected { voices: [...] }');
  }
  const voices = (payload as { voices: unknown }).voices;
  if (!Array.isArray(voices)) {
    throw new Error('Invalid voices response: expected { voices: [...] }');
  }
  return voices as Array<{ id?: unknown; label?: unknown; kind?: unknown }>;
}

export async function resolvePersonaVoiceId(
  client: PostEngineerClient,
  voiceId: string | undefined,
): Promise<string | undefined> {
  const trimmed = (voiceId ?? '').trim();
  if (trimmed.length === 0) return undefined;
  const lowered = trimmed.toLowerCase();
  if (lowered === 'no-voice' || lowered === 'none') return trimmed;

  const house = houseMatch(trimmed);
  if (house !== null) return house;

  const payload = await client.listVoices();
  const cloned = voiceEntries(payload).filter((entry) => entry.kind === 'cloned');
  const matches = cloned.filter((entry) => cloneMatches(trimmed, entry));
  const resolved = new Set(
    matches.map((entry) => (typeof entry.id === 'string' ? entry.id : '')).filter((id) => id !== ''),
  );
  if (resolved.size !== 1) throwUnknownVoice();
  return resolved.values().next().value;
}

/** withResolvedPersonaVoice — awaited by the tool handlers so the routed id
 *  is what reaches the client; a voiceId left undefined stays untouched
 *  (update without a voiceId skips entirely). */
export async function withResolvedPersonaVoice<T extends { voiceId?: string }>(
  client: PostEngineerClient,
  input: T,
): Promise<T> {
  const voiceId = await resolvePersonaVoiceId(client, input.voiceId);
  if (voiceId === undefined || voiceId === input.voiceId) return input;
  return { ...input, voiceId };
}
