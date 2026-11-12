// Remote (HTTP) persona shapes: the same tools the stdio server offers,
// minus every field that names a file on disk.
//
// A path served over HTTP would resolve on the MCP server's filesystem,
// not on the agent's machine, so the remote surface cannot carry one:
// create_persona keeps only avatarUrl (no avatarPath, no library images),
// and update_persona keeps only avatarUrl. The schemas are strict so a
// smuggled path field fails loudly instead of being silently dropped,
// and the handlers re-parse with them before any client call.
import { z } from 'zod';

import { CreatePersonaAvatarFields, UpdatePersonaAvatarFields, refinePersonaAvatar } from './persona-avatar.js';
import { UpdatePersonaShape } from './persona-update.js';
import { CreatePersonaShape } from './tools.js';

/** create_persona over HTTP: avatarUrl only, no library image files. */
export const CreatePersonaRemoteShape = {
  name: CreatePersonaShape.name,
  avatarUrl: CreatePersonaAvatarFields.avatarUrl,
  voiceId: CreatePersonaShape.voiceId,
  language: CreatePersonaShape.language,
  videoAspect: CreatePersonaShape.videoAspect,
  videoLayout: CreatePersonaShape.videoLayout,
  scriptPrompt: CreatePersonaShape.scriptPrompt,
  paragraphNumber: CreatePersonaShape.paragraphNumber,
  niche: CreatePersonaShape.niche,
  faceQuality: CreatePersonaShape.faceQuality,
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
