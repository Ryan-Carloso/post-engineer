import type { CreatePersonaInput, UpdatePersonaInput } from './client-types.js';
import { appendPersonaCtaFields } from './persona-cta-shape.js';

export function appendCreatePersonaFields(formData: FormData, input: CreatePersonaInput): void {
  formData.set('name', input.name);
  formData.set('voiceId', input.voiceId);
  formData.set('language', input.language ?? 'en-US');
  formData.set('videoAspect', input.videoAspect ?? '9:16');
  formData.set('videoLayout', input.videoLayout ?? 'standard');
  formData.set('hookPanel', String(input.hookPanel ?? true));
  if (input.scriptPrompt !== undefined) formData.set('scriptPrompt', input.scriptPrompt);
  formData.set('paragraphNumber', String(input.paragraphNumber ?? 1));
  formData.set('niche', input.niche ?? 'General');
  formData.set('faceQuality', input.faceQuality ?? 'very_good');
  appendPersonaCtaFields(formData, input.cta);
}

export function appendUpdatePersonaFields(formData: FormData, input: UpdatePersonaInput): void {
  if (input.voiceId !== undefined) formData.set('voiceId', input.voiceId);
  if (input.language !== undefined) formData.set('language', input.language);
  if (input.videoAspect !== undefined) formData.set('videoAspect', input.videoAspect);
  if (input.videoLayout !== undefined) formData.set('videoLayout', input.videoLayout);
  if (input.hookPanel !== undefined) formData.set('hookPanel', String(input.hookPanel));
  if (input.scriptPrompt !== undefined) formData.set('scriptPrompt', input.scriptPrompt);
  if (input.paragraphNumber !== undefined) formData.set('paragraphNumber', String(input.paragraphNumber));
  if (input.niche !== undefined) formData.set('niche', input.niche);
  if (input.faceQuality !== undefined) formData.set('faceQuality', input.faceQuality);
  appendPersonaCtaFields(formData, input.cta);
}
