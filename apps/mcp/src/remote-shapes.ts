// Remote (HTTP) persona shapes: the same tools the stdio server offers,
// minus every field that names a file on disk.
//
// A path served over HTTP would resolve on the MCP server's filesystem,
// not on the agent's machine, so the remote surface cannot carry one:
// create_persona keeps only avatarUrl (no avatarPath, no library images),
// and update_persona keeps only avatarUrl. The SDK parses tool args with
// the registered raw shape, which strips unknown keys before the handler
// runs — so a smuggled path is dropped (never read), not loudly rejected.
// The strict re-parse is defense-in-depth for direct handler callers only.
import { z } from 'zod';

import { UpdatePersonaAvatarFields, refinePersonaAvatar } from './persona-avatar.js';
import { UpdatePersonaShape } from './persona-update.js';
import { CreatePersonaShape } from './tools.js';

/** create_persona over HTTP: avatarUrl only, no library image files. */
export const CreatePersonaRemoteShape = {
  name: CreatePersonaShape.name,
  avatarUrl: z
    .string()
    .url()
    .optional()
    .describe(
      'Public URL to the persona avatar image (use list_faces for stock face URLs). Required: every persona has a face; "no face" is chosen per video with generate_persona_video options.videoType: \'faceless\'.',
    ),
  voiceId: CreatePersonaShape.voiceId,
  language: CreatePersonaShape.language,
  videoAspect: CreatePersonaShape.videoAspect,
  videoLayout: CreatePersonaShape.videoLayout,
  scriptPrompt: CreatePersonaShape.scriptPrompt,
  paragraphNumber: CreatePersonaShape.paragraphNumber,
  niche: CreatePersonaShape.niche,
  faceQuality: CreatePersonaShape.faceQuality,
  // Issue #572: same binding rule as the local shape — a persona is born
  // bound to at least one publishing account. Without this field the
  // handler's re-parse against CreatePersonaSchema (which requires
  // accounts) would reject every remote create_persona call.
  accounts: CreatePersonaShape.accounts,
};

export const CreatePersonaRemoteSchema = z
  .object(CreatePersonaRemoteShape)
  .strict()
  .superRefine(refinePersonaAvatar(true));

/** update_persona over HTTP: avatarUrl only. */
export const UpdatePersonaRemoteShape = {
  personaId: UpdatePersonaShape.personaId,
  name: UpdatePersonaShape.name,
  avatarUrl: UpdatePersonaAvatarFields.avatarUrl,
  voiceId: UpdatePersonaShape.voiceId,
  language: UpdatePersonaShape.language,
  videoAspect: UpdatePersonaShape.videoAspect,
  videoLayout: UpdatePersonaShape.videoLayout,
  scriptPrompt: UpdatePersonaShape.scriptPrompt,
  paragraphNumber: UpdatePersonaShape.paragraphNumber,
  niche: UpdatePersonaShape.niche,
  faceQuality: UpdatePersonaShape.faceQuality,
};

export const UpdatePersonaRemoteSchema = z
  .object(UpdatePersonaRemoteShape)
  .strict()
  .superRefine(refinePersonaAvatar(false));
