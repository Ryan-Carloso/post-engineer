//---------------
// Library-image validation used by POST /api/persona at creation.
// Extracted so route.ts can stay under the file-size ratchet.
//---------------

import {
  MAX_PERSONA_IMAGES,
  readValidatedImage,
  validateImageFile,
  type LibraryImageInput,
} from '@/lib/persona-images';

export function withImageContext(error: string, index: number, fileName: string): string {
  const name = fileName.trim() === '' ? '' : `: ${fileName}`;
  return `${error} (image ${index + 1}${name})`;
}

export async function validateLibraryInputs(
  inputs: LibraryImageInput[],
): Promise<{ inputs: LibraryImageInput[] } | { error: string }> {
  if (inputs.length === 0) return { inputs: [] };
  if (inputs.length > MAX_PERSONA_IMAGES) {
    return { error: `Image library accepts at most ${MAX_PERSONA_IMAGES} images.` };
  }
  const validated: LibraryImageInput[] = [];
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index] as LibraryImageInput;
    const fileCheck = validateImageFile(input.file);
    if ('error' in fileCheck) {
      return { error: withImageContext(fileCheck.error, index, input.file.name) };
    }
    const content = await readValidatedImage(fileCheck.file);
    if ('error' in content) {
      return { error: withImageContext(content.error, index, input.file.name) };
    }
    validated.push({
      ...input,
      validatedContent: { bytes: content.bytes, mime: content.mime },
    });
  }
  return { inputs: validated };
}
