import { z } from 'zod';

//---------------
// Zod schema for the persona form — the SINGLE source of validation.
// Used by POST /api/persona, by the video-job debug branch, and by the
// client (fails before the POST).
//---------------

export const VALID_VIDEO_ASPECTS = ['9:16', '16:9', '1:1'] as const;
export const PERSONA_MODES = ['persona', 'faceless'] as const;
export const FACE_QUALITIES = ['ok', 'very_good'] as const;

export const PHOTO_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

//---------------
// optionalText — an empty FormData string becomes a missing field (undefined),
// preserving the form's "not provided" semantics.
//---------------
const optionalText = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

export const personaFormSchema = z.object({
  personaMode: optionalText(z.enum(PERSONA_MODES)),
  name: z.string().trim().min(1).optional(),
  avatarUrl: optionalText(z.string()),
  voiceId: optionalText(z.string()),
  // Unbounded in the DB (text column), so cap it at the API boundary: 35 is
  // the BCP 47 max tag length. Applied to the JSON video-job flow
  // (route guard), the debug flow, and persona creation alike.
  language: optionalText(z.string().max(35)),
  videoAspect: optionalText(z.enum(VALID_VIDEO_ASPECTS)),
  scriptPrompt: optionalText(z.string().max(2000)),
  niche: optionalText(z.string().max(300)),
  paragraphNumber: optionalText(z.coerce.number().int().min(1).max(10)),
  faceMixPercent: optionalText(z.coerce.number().min(0).max(100)),
  faceQuality: optionalText(z.enum(FACE_QUALITIES)),
  // The JSON video-job flow caps video_subject at 300 (multi-megabyte
  // subjects would be fed into LLM prompts); the debug flow shares this
  // schema, so the cap applies to both branches — and to persona creation,
  // where niche (the subject's default source) is already capped at 300.
  video_subject: optionalText(z.string().max(300)),
});

//---------------
// FIELD_ERRORS — per-field messages, preserving the original 400 errors
// from the routes (contract already consumed by tests/client).
//---------------
const FIELD_ERRORS: Record<string, (value: unknown) => string> = {
  personaMode: () => 'Invalid personaMode: use "persona" or "faceless".',
  videoAspect: (value) => `Invalid videoAspect: ${String(value)}. Use one of ${VALID_VIDEO_ASPECTS.join(', ')}.`,
  niche: () => 'Invalid niche: use at most 300 characters.',
  scriptPrompt: () => 'Invalid scriptPrompt: use at most 2000 characters.',
  paragraphNumber: () => 'Invalid paragraphNumber: use an integer between 1 and 10.',
  faceMixPercent: () => 'Invalid faceMixPercent: use a number between 0 and 100.',
  faceQuality: () => 'Invalid faceQuality: use "ok" or "very_good".',
  video_subject: () => 'Invalid video_subject: use at most 300 characters.',
  language: () => 'Invalid language: use at most 35 characters.',
};

function fieldErrorMessage(error: z.ZodError, entries: Record<string, unknown>): string {
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '');
    const builder = FIELD_ERRORS[key];
    if (builder) {
      return builder(entries[key]);
    }
  }
  return 'Invalid persona form payload.';
}

export type PersonaFormValues = z.infer<typeof personaFormSchema>;

export type PersonaFormMode = 'create' | 'debug';

export type ParsedPersonaForm = {
  values: {
    personaMode: (typeof PERSONA_MODES)[number];
    name: string | null;
    avatarUrl: string | null;
    voiceId: string | null;
    language: string | null;
    videoAspect: string | null;
    scriptPrompt: string | null;
    paragraphNumber: number | null;
    niche: string | null;
    faceMixPercent: number | null;
    faceQuality: (typeof FACE_QUALITIES)[number] | null;
    videoSubject: string | null;
  };
  photo: File | null;
  photoExtension: string | null;
};

export type ParsePersonaFormResult =
  | { ok: true; value: ParsedPersonaForm }
  | { ok: false; error: string };

function extensionFor(file: File, extensionByType: Record<string, string>): string | null {
  return extensionByType[file.type] ?? null;
}

//---------------
// photoExtensionOf — accepted extension for the file
// (null = unsupported format). Used in validation and upload.
//---------------
export function photoExtensionOf(photo: File | null): string | null {
  return photo ? extensionFor(photo, PHOTO_EXTENSIONS) : null;
}

function imageExtensionError(photo: File | null): string | null {
  if (photo && !photoExtensionOf(photo)) {
    return `Unsupported photo format: ${photo.type}`;
  }
  return null;
}

function fileFrom(formData: FormData, key: string): File | null {
  const value = formData.get(key);
  return value instanceof File ? value : null;
}

//---------------
// parsePersonaForm — validates a persona FormData (normal creation or
// debug generation). Files are checked by type/accept; strings and
// numbers by the zod schema. Per-mode rules:
//  - create: name is required.
//  - debug: video_subject is required (direct field, niche, or script).
//---------------

export function parsePersonaForm(formData: FormData, mode: PersonaFormMode): ParsePersonaFormResult {
  const entries = Object.fromEntries(
    Array.from(formData.entries()).filter(([, value]) => typeof value === 'string'),
  );
  const parsed = personaFormSchema.safeParse(entries);
  if (!parsed.success) {
    return { ok: false, error: fieldErrorMessage(parsed.error, entries) };
  }
  const values = parsed.data;

  const photo = fileFrom(formData, 'photo');
  const photoError = imageExtensionError(photo);
  if (photoError) {
    return { ok: false, error: photoError };
  }
  const photoExtension = photoExtensionOf(photo);

  if (mode === 'create' && !values.name) {
    return { ok: false, error: 'Persona name is required.' };
  }

  const videoSubject =
    values.video_subject?.trim()
    || values.niche?.trim()
    || values.scriptPrompt?.trim()
    || null;
  if (mode === 'debug' && !videoSubject) {
    return { ok: false, error: 'video_subject is required.' };
  }
  // The direct field and niche are zod-capped at 300, but the scriptPrompt
  // fallback (capped at 2000) could yield a subject that bypasses the cap
  // the JSON flow enforces. Reject it the same way instead of letting a
  // multi-hundred-char subject into the prompts. (Create mode ignores the
  // subject — it is not persisted — so the check only applies to debug.)
  if (mode === 'debug' && videoSubject && videoSubject.length > 300) {
    return { ok: false, error: 'Invalid video_subject: use at most 300 characters.' };
  }

  return {
    ok: true,
    value: {
      values: {
        personaMode: values.personaMode ?? 'persona',
        name: values.name ?? null,
        avatarUrl: values.avatarUrl ?? null,
        voiceId: values.voiceId ?? null,
        language: values.language ?? null,
        videoAspect: values.videoAspect ?? null,
        scriptPrompt: values.scriptPrompt ?? null,
        paragraphNumber: values.paragraphNumber ?? null,
        niche: values.niche ?? null,
        faceMixPercent: values.faceMixPercent ?? null,
        faceQuality: values.faceQuality ?? null,
        videoSubject,
      },
      photo,
      photoExtension,
    },
  };
}

//---------------
// validateVisualCues — persona visual-identity rule.
// - Persona mode (default / backward-compat): requires EXACTLY one image
//   source (photo file or avatarUrl).
// - Faceless mode (100% stock footage, no avatar, no lipsync):
//   no image is allowed — avoids persisting a photo that would reactivate
//   the avatar path in the engine.
// - Explicit mix 0 (100% faceless via hybrid): same rule as faceless.
// Returns the error message, or null when valid.
//---------------
export function validateVisualCues(
  personaMode: 'persona' | 'faceless',
  faceMixPercent: number | null,
  hasPhoto: boolean,
  hasAvatarUrl: boolean,
): string | null {
  if (personaMode === 'faceless' || faceMixPercent === 0) {
    if (hasPhoto || hasAvatarUrl) {
      return faceMixPercent === 0
        ? 'faceMixPercent 0 means 100% faceless: omit the photo and avatarUrl.'
        : 'Faceless persona must not include a photo or avatarUrl.';
    }
    return null;
  }
  if (hasPhoto === hasAvatarUrl) {
    return 'Provide exactly one of: photo file or avatarUrl.';
  }
  return null;
}

//---------------
// validateVoiceSource — the creation flow requires the house voice (voiceId).
//---------------
export function validateVoiceSource(voiceId: string | null): string | null {
  if (!voiceId) {
    return 'Provide voiceId.';
  }
  return null;
}
