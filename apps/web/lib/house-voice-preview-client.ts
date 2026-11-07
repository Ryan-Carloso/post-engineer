//---------------
// House voice preview — POST the caller's text to the house preview route
// and return the audio blob. Never throws on HTTP errors: the caller maps
// the status to UI copy (429 = daily limit, 400 = text too long).
//---------------

import { HOUSE_PREVIEW_TEXT_MAX_CHARS } from '@/app/api/persona/voices/[voiceId]/preview/preview-text';
import { notifyIfSessionExpired } from '@/lib/session-expiry';

export { HOUSE_PREVIEW_TEXT_MAX_CHARS };

export type HouseVoicePreviewResult =
  | { success: true; audio: Blob }
  | { success: false; status: number; error: string };

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchHouseVoicePreview(
  voiceId: string,
  text: string,
): Promise<HouseVoicePreviewResult> {
  try {
    const response = await fetch(`/api/persona/voices/${encodeURIComponent(voiceId)}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('audio/')) {
      if (!response.ok) notifyIfSessionExpired(response);
      const data = await parseJson(response);
      const error =
        typeof data === 'object' &&
        data !== null &&
        'error' in data &&
        typeof data.error === 'string'
          ? data.error
          : 'Could not play the preview.';
      return { success: false, status: response.status, error };
    }
    return { success: true, audio: await response.blob() };
  } catch {
    return { success: false, status: 0, error: 'Could not play the preview.' };
  }
}
