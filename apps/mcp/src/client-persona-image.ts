import type { PostEngineerClient } from './client.js';
import { parseContractResponse } from './contract-response.js';
import { addPersonaImage as addPersonaImageContract } from './contracts/personas.js';
import type { ResponseOf } from './contracts/endpoint.js';
import { MAX_LIBRARY_IMAGE_BYTES } from './limits.js';
import { fetchRemoteImage } from './remote-image-fetch.js';
import type { HostLookup } from './public-fetch.js';

const UPLOAD_TIMEOUT_MS = 120_000;

export async function addPersonaImageFromUrl(
  client: PostEngineerClient,
  personaId: string,
  image: { imageUrl: string; tag?: string; description?: string; isPrimary?: true },
  lookup?: HostLookup,
): Promise<ResponseOf<typeof addPersonaImageContract>> {
  const { buffer, mimeType, filename } = await fetchRemoteImage(image.imageUrl, {
    maxBytes: MAX_LIBRARY_IMAGE_BYTES,
    lookup,
  });
  const formData = new FormData();
  formData.set('personaId', personaId);
  formData.append('image', new Blob([buffer], { type: mimeType }), filename);
  const tag = image.tag?.trim() ?? '';
  const description = image.description?.trim() ?? '';
  if (tag !== '') formData.set('tag', tag);
  if (description !== '') formData.set('description', description);
  if (image.isPrimary === true) formData.set('isPrimary', 'true');
  const raw = await client.request(
    '/api/persona/images',
    { method: 'POST', headers: client.getHeaders(false), body: formData },
    'add persona image',
    UPLOAD_TIMEOUT_MS,
  );
  return parseContractResponse(addPersonaImageContract, raw);
}
