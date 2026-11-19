import { FACE_QUALITIES, PERSONA_CTA_INSTRUCTION_MAX_LENGTH, PERSONA_CTA_TYPES, PERSONA_CTA_URL_MAX_LENGTH, photoExtensionOf, VALID_VIDEO_ASPECTS, VIDEO_LAYOUTS } from '@/lib/persona-schema';
import { isEnglishLanguage, ONLY_ENGLISH_VIDEOS_MESSAGE } from '@/lib/language-gate';
import { isFileLike } from '@/lib/persona-images';

function isVideoLayout(value: string): value is (typeof VIDEO_LAYOUTS)[number] {
  return (VIDEO_LAYOUTS as readonly string[]).includes(value);
}

export interface PersonaPatchBody {
  name: string | null;
  photo: File | null;
  photoExtension: string | null;
  avatarUrl: string | null;
  voiceId: string | null;
  language: string | null;
  videoAspect: string | null;
  videoLayout: (typeof VIDEO_LAYOUTS)[number] | null;
  scriptPrompt: string | null;
  ctaType: (typeof PERSONA_CTA_TYPES)[number] | null;
  ctaUrl: string | null;
  ctaInstruction: string | null;
  paragraphNumber: number | null;
  niche: string | null;
  faceQuality: (typeof FACE_QUALITIES)[number] | null;
}

type ParsePatchResult =
  | { ok: true; value: PersonaPatchBody }
  | { ok: false; error: string; logMessage?: string };

export async function parsePatchBody(request: Request): Promise<ParsePatchResult> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return { ok: false, error: 'Invalid multipart payload.' };
  }

  const rawName = formData.get('name');
  const name = typeof rawName === 'string' && rawName.trim().length > 0 ? rawName : null;

  const avatarUrl = optionalString(formData.get('avatarUrl'));
  const voiceId = optionalString(formData.get('voiceId'));

  const photo = asFile(formData.get('photo'));
  const photoExtension = photoExtensionOf(photo);
  if (photo && !photoExtension) {
    return {
      ok: false,
      error: `Unsupported photo format: ${photo.type}`,
      logMessage: 'Unsupported photo format.',
    };
  }

  const language = optionalString(formData.get('language'));
  const videoAspect = optionalString(formData.get('videoAspect'));
  if (videoAspect !== null && !VALID_VIDEO_ASPECTS.includes(videoAspect as (typeof VALID_VIDEO_ASPECTS)[number])) {
    return {
      ok: false,
      error: `Invalid videoAspect: ${videoAspect}. Use one of ${VALID_VIDEO_ASPECTS.join(', ')}.`,
      logMessage: `Invalid videoAspect. Use one of ${VALID_VIDEO_ASPECTS.join(', ')}.`,
    };
  }
  const videoLayout = optionalString(formData.get('videoLayout'));
  if (videoLayout !== null && !isVideoLayout(videoLayout)) {
    return {
      ok: false,
      error: `Invalid videoLayout: ${videoLayout}. Use one of ${VIDEO_LAYOUTS.join(', ')}.`,
      logMessage: `Invalid videoLayout. Use one of ${VIDEO_LAYOUTS.join(', ')}.`,
    };
  }
  const scriptPrompt = optionalString(formData.get('scriptPrompt'));
  const ctaType = optionalString(formData.get('ctaType'));
  if (ctaType !== null && !(PERSONA_CTA_TYPES as readonly string[]).includes(ctaType)) {
    return {
      ok: false,
      error: `Invalid ctaType: ${ctaType}. Use one of ${PERSONA_CTA_TYPES.join(', ')}.`,
      logMessage: `Invalid ctaType. Use one of ${PERSONA_CTA_TYPES.join(', ')}.`,
    };
  }
  const rawCtaUrl = formData.get('ctaUrl');
  const ctaUrl =
    typeof rawCtaUrl === 'string' ? (rawCtaUrl.trim().length === 0 ? '' : rawCtaUrl) : null;
  if (ctaUrl !== null && ctaUrl.length > 0) {
    if (ctaUrl.length > PERSONA_CTA_URL_MAX_LENGTH) {
      return { ok: false, error: `Invalid ctaUrl: use at most ${PERSONA_CTA_URL_MAX_LENGTH} characters.` };
    }
    try {
      new URL(ctaUrl);
    } catch {
      return { ok: false, error: 'Invalid ctaUrl: use a valid URL.' };
    }
  }
  const rawCtaInstruction = formData.get('ctaInstruction');
  const ctaInstruction =
    typeof rawCtaInstruction === 'string' ? (rawCtaInstruction.trim().length === 0 ? '' : rawCtaInstruction) : null;
  if (ctaInstruction !== null && ctaInstruction.length > PERSONA_CTA_INSTRUCTION_MAX_LENGTH) {
    return { ok: false, error: `Invalid ctaInstruction: use at most ${PERSONA_CTA_INSTRUCTION_MAX_LENGTH} characters.` };
  }
  const niche = optionalString(formData.get('niche'));
  if (niche !== null && niche.length > 300) {
    return { ok: false, error: 'Invalid niche: use at most 300 characters.' };
  }
  const paragraphNumberRaw = optionalString(formData.get('paragraphNumber'));
  let paragraphNumber: number | null = null;
  if (paragraphNumberRaw !== null) {
    const parsedNumber = Number.parseInt(paragraphNumberRaw, 10);
    if (!Number.isInteger(parsedNumber) || parsedNumber < 1 || parsedNumber > 10) {
      return { ok: false, error: 'Invalid paragraphNumber: use an integer between 1 and 10.' };
    }
    paragraphNumber = parsedNumber;
  }
  const faceQuality = optionalString(formData.get('faceQuality'));
  if (faceQuality !== null && !(FACE_QUALITIES as readonly string[]).includes(faceQuality)) {
    return {
      ok: false,
      error: `Invalid faceQuality: ${faceQuality}. Use one of ${FACE_QUALITIES.join(', ')}.`,
      logMessage: `Invalid faceQuality. Use one of ${FACE_QUALITIES.join(', ')}.`,
    };
  }

  return {
    ok: true,
    value: {
      name,
      photo,
      photoExtension,
      avatarUrl,
      voiceId,
      language,
      videoAspect,
      videoLayout,
      scriptPrompt,
      ctaType: ctaType as (typeof PERSONA_CTA_TYPES)[number] | null,
      ctaUrl,
      ctaInstruction,
      paragraphNumber,
      niche,
      faceQuality: faceQuality as (typeof FACE_QUALITIES)[number] | null,
    },
  };
}

function asFile(value: FormDataEntryValue | null): File | null {
  return isFileLike(value) ? value : null;
}

function optionalString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return value;
}

export function englishOnlyPatchError(patch: PersonaPatchBody): string | null {
  if (
    patch.language !== null
    && patch.language.trim().length > 0
    && !isEnglishLanguage(patch.language)
  ) {
    return ONLY_ENGLISH_VIDEOS_MESSAGE;
  }
  return null;
}
