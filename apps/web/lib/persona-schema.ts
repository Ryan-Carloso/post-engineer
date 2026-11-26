import { z } from 'zod';
import {
  FACE_QUALITIES,
  PERSONA_CTA_INSTRUCTION_MAX_LENGTH,
  PERSONA_CTA_TYPES,
  PERSONA_CTA_URL_MAX_LENGTH,
  VALID_VIDEO_ASPECTS,
  VIDEO_LAYOUTS,
} from './contracts/personas';
import {
  emptyPersonaDefaultAccounts,
  parsePublishingAccountsField,
  type PersonaDefaultAccounts,
} from './persona-publishing-accounts';
import { HOOK_PANEL_FORM_VALUES, invalidHookPanelMessage } from './hook-panel-form';
import { AI_LABEL_FORM_VALUES, invalidAiLabelMessage } from './ai-label-form';
import type { IdentityCard } from './contracts/persona-identity-card';
import { parseIdentityCardField } from '@/app/api/persona/identity-card-field';

export { FACE_QUALITIES, PERSONA_CTA_TYPES, PERSONA_CTA_URL_MAX_LENGTH, PERSONA_CTA_INSTRUCTION_MAX_LENGTH, VALID_VIDEO_ASPECTS, VIDEO_LAYOUTS };

export const PHOTO_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const optionalText = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

export const personaFormSchema = z.object({
  name: z.string().trim().min(1).optional(),
  avatarUrl: optionalText(z.string()),
  voiceId: optionalText(z.string()),
  language: optionalText(z.string().max(35)),
  videoAspect: optionalText(z.enum(VALID_VIDEO_ASPECTS)),
  videoLayout: optionalText(z.enum(VIDEO_LAYOUTS)),
  hookPanel: optionalText(z.enum(HOOK_PANEL_FORM_VALUES)),
  aiLabel: optionalText(z.enum(AI_LABEL_FORM_VALUES)),
  scriptPrompt: optionalText(z.string().max(2000)),
  ctaType: optionalText(z.enum(PERSONA_CTA_TYPES)),
  ctaUrl: optionalText(z.string().max(PERSONA_CTA_URL_MAX_LENGTH).url()),
  ctaInstruction: optionalText(z.string().max(PERSONA_CTA_INSTRUCTION_MAX_LENGTH)),
  niche: optionalText(z.string().max(300)),
  paragraphNumber: optionalText(z.coerce.number().int().min(1).max(10)),
  faceQuality: optionalText(z.enum(FACE_QUALITIES)),
  video_subject: optionalText(z.string().max(300)),
});

const FIELD_ERRORS: Record<string, (value: unknown) => string> = {
  videoAspect: (value) => `Invalid videoAspect: ${String(value)}. Use one of ${VALID_VIDEO_ASPECTS.join(', ')}.`,
  videoLayout: (value) => `Invalid videoLayout: ${String(value)}. Use one of ${VIDEO_LAYOUTS.join(', ')}.`,
  hookPanel: (value) => invalidHookPanelMessage(value),
  aiLabel: (value) => invalidAiLabelMessage(value),
  niche: () => 'Invalid niche: use at most 300 characters.',
  scriptPrompt: () => 'Invalid scriptPrompt: use at most 2000 characters.',
  ctaType: (value) => `Invalid ctaType: ${String(value)}. Use one of ${PERSONA_CTA_TYPES.join(', ')}.`,
  ctaUrl: () => `Invalid ctaUrl: use a valid URL of at most ${PERSONA_CTA_URL_MAX_LENGTH} characters.`,
  ctaInstruction: () => `Invalid ctaInstruction: use at most ${PERSONA_CTA_INSTRUCTION_MAX_LENGTH} characters.`,
  paragraphNumber: () => 'Invalid paragraphNumber: use an integer between 1 and 10.',
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
    name: string | null;
    avatarUrl: string | null;
    voiceId: string | null;
    language: string | null;
    videoAspect: string | null;
    videoLayout: (typeof VIDEO_LAYOUTS)[number] | null;
    hookPanel: boolean | null;
    aiLabel: boolean | null;
    scriptPrompt: string | null;
    ctaType: (typeof PERSONA_CTA_TYPES)[number];
    ctaUrl: string | null;
    ctaInstruction: string | null;
    paragraphNumber: number | null;
    niche: string | null;
    faceQuality: (typeof FACE_QUALITIES)[number] | null;
    videoSubject: string | null;
    identityCard: IdentityCard | null;
    publishingAccounts: PersonaDefaultAccounts;
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

export function parsePersonaForm(formData: FormData, mode: PersonaFormMode): ParsePersonaFormResult {
  const entries = Object.fromEntries(
    Array.from(formData.entries()).filter(([, value]) => typeof value === 'string'),
  );
  const parsed = personaFormSchema.safeParse(entries);
  if (!parsed.success) {
    return { ok: false, error: fieldErrorMessage(parsed.error, entries) };
  }
  const values = parsed.data;

  const ctaError = validateCtaCoherence(values.ctaType ?? null, values.ctaUrl ?? null, values.ctaInstruction ?? null);
  if (ctaError) {
    return { ok: false, error: ctaError };
  }

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
  if (mode === 'debug' && videoSubject && videoSubject.length > 300) {
    return { ok: false, error: 'Invalid video_subject: use at most 300 characters.' };
  }
  const binding = parsePublishingAccountsField(formData.get('publishingAccounts'));
  if (mode === 'create' && !binding.ok) {
    return { ok: false, error: binding.error };
  }

  const identityCard = parseIdentityCardField(formData.get('identityCard'));
  if (identityCard.status === 'invalid') {
    return { ok: false, error: identityCard.error };
  }

  return {
    ok: true,
    value: {
      values: {
        name: values.name ?? null,
        avatarUrl: values.avatarUrl ?? null,
        voiceId: values.voiceId ?? null,
        language: values.language ?? null,
        videoAspect: values.videoAspect ?? null,
        videoLayout: values.videoLayout ?? null,
        hookPanel: values.hookPanel === undefined ? null : values.hookPanel === 'true',
        aiLabel: values.aiLabel === undefined ? null : values.aiLabel === 'true',
        scriptPrompt: values.scriptPrompt ?? null,
        ctaType: values.ctaType ?? 'follow',
        ctaUrl: values.ctaUrl ?? null,
        ctaInstruction: values.ctaInstruction ?? null,
        paragraphNumber: values.paragraphNumber ?? null,
        niche: values.niche ?? null,
        faceQuality: values.faceQuality ?? null,
        videoSubject,
        identityCard: identityCard.status === 'set' ? identityCard.card : null,
        publishingAccounts: binding.ok ? binding.accounts : emptyPersonaDefaultAccounts(),
      },
      photo,
      photoExtension,
    },
  };
}

export function validateCtaCoherence(
  type: (typeof PERSONA_CTA_TYPES)[number] | null,
  url: string | null,
  instruction: string | null,
): string | null {
  if (type === 'link' || type === 'buy') {
    if (!url) return `A ${type} CTA needs a URL.`;
    if (instruction) return `A ${type} CTA takes a URL, not an instruction.`;
    return null;
  }
  if (type === 'other') {
    if (!instruction) return 'An other CTA needs an instruction.';
    if (url) return 'An other CTA takes an instruction, not a URL.';
    return null;
  }
  if (url || instruction) return 'A follow, comment, share or save CTA takes no URL or instruction.';
  return null;
}

export function parsePersonaCtaType(value: string | null | undefined): (typeof PERSONA_CTA_TYPES)[number] {
  return (PERSONA_CTA_TYPES as readonly string[]).includes(value ?? '')
    ? (value as (typeof PERSONA_CTA_TYPES)[number])
    : 'follow';
}

export function validateVisualCues(hasPhoto: boolean, hasAvatarUrl: boolean): string | null {
  if (hasPhoto === hasAvatarUrl) {
    return 'Provide exactly one of: photo file or avatarUrl.';
  }
  return null;
}

export function validateVoiceSource(voiceId: string | null): string | null {
  if (!voiceId) {
    return 'Provide voiceId.';
  }
  return null;
}
