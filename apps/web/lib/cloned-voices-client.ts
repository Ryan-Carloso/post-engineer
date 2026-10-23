import type { ClonedVoicePublicRow } from '@/lib/cloned-voices-types';
import { narrowClonedVoiceRow } from '@/lib/cloned-voices-types';

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchClonedVoices(): Promise<ClonedVoicePublicRow[]> {
  const response = await fetch('/api/persona/cloned-voices');
  const data = await parseJson(response);
  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
        ? data.error
        : 'Failed to load cloned voices.';
    throw new Error(message);
  }
  if (
    typeof data !== 'object' ||
    data === null ||
    !('voices' in data) ||
    !Array.isArray((data as { voices: unknown }).voices)
  ) {
    throw new Error('Invalid cloned voices response.');
  }
  return (data as { voices: unknown[] }).voices
    .map(narrowClonedVoiceRow)
    .filter((row): row is ClonedVoicePublicRow => row !== null);
}

export async function fetchClonedVoice(cloneId: string): Promise<ClonedVoicePublicRow> {
  const response = await fetch(`/api/persona/cloned-voices/${encodeURIComponent(cloneId)}`);
  const data = await parseJson(response);
  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
        ? data.error
        : 'Failed to load cloned voice.';
    throw new Error(message);
  }
  const row =
    typeof data === 'object' && data !== null && 'voice' in data
      ? narrowClonedVoiceRow((data as { voice: unknown }).voice)
      : null;
  if (row === null) {
    throw new Error('Invalid cloned voice response.');
  }
  return row;
}

export async function createClonedVoice(
  file: Blob,
  language: string,
  consent: boolean,
  denoise: boolean,
): Promise<ClonedVoicePublicRow> {
  const formData = new FormData();
  formData.set('consent', consent ? 'true' : 'false');
  formData.set('denoise', denoise ? 'true' : 'false');
  formData.set('language', language);
  formData.set('file', file, 'reference.webm');
  const response = await fetch('/api/persona/cloned-voices', {
    method: 'POST',
    body: formData,
  });
  const data = await parseJson(response);
  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
        ? data.error
        : 'Could not create voice clone.';
    throw new Error(message);
  }
  const row =
    typeof data === 'object' && data !== null && 'voice' in data
      ? narrowClonedVoiceRow((data as { voice: unknown }).voice)
      : null;
  if (row === null) {
    throw new Error('Invalid clone create response.');
  }
  return row;
}

export async function deleteClonedVoice(cloneId: string): Promise<void> {
  const response = await fetch(`/api/persona/cloned-voices/${encodeURIComponent(cloneId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const data = await parseJson(response);
    const message =
      typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
        ? data.error
        : 'Could not delete cloned voice.';
    throw new Error(message);
  }
}

export function clonedVoicePreviewUrl(cloneId: string, language: string | null): string {
  const base = `/api/persona/cloned-voices/${encodeURIComponent(cloneId)}/preview`;
  if (language && language.trim()) {
    return `${base}?language=${encodeURIComponent(language.trim())}`;
  }
  return base;
}

// Cleaned (denoised) WAV of a reference recording, for the A/B listen
// before cloning. Never throws on HTTP errors.
export async function fetchDenoisePreview(
  file: Blob,
): Promise<{ success: true; audio: Blob } | { success: false; error: string }> {
  const formData = new FormData();
  formData.set('file', file, 'reference.webm');
  try {
    const response = await fetch('/api/persona/cloned-voices/denoise-preview', {
      method: 'POST',
      body: formData,
    });
    if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('audio/')) {
      const data = await parseJson(response);
      const error =
        typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
          ? data.error
          : 'Could not clean the audio.';
      return { success: false, error };
    }
    return { success: true, audio: await response.blob() };
  } catch {
    return { success: false, error: 'Could not clean the audio.' };
  }
}
