import { photoExtensionOf } from '@/lib/persona-schema';
import { isFileLike } from '@/lib/persona-photo';
import { parseIdentityCardField, type IdentityCardField } from './identity-card-field';

export interface PersonaPatchBody {
  name: string | null;
  photo: File | null;
  photoExtension: string | null;
  identityCard: IdentityCardField;
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

  const rawPhoto = formData.get('photo');
  const photo = isFileLike(rawPhoto) ? rawPhoto : null;
  const photoExtension = photoExtensionOf(photo);
  if (photo && !photoExtension) {
    return {
      ok: false,
      error: `Unsupported photo format: ${photo.type}`,
      logMessage: 'Unsupported photo format.',
    };
  }

  const identityCard = parseIdentityCardField(formData.get('identityCard'));
  if (identityCard.status === 'invalid') {
    return { ok: false, error: identityCard.error };
  }

  return { ok: true, value: { name, photo, photoExtension, identityCard } };
}
