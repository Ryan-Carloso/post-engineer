import { z } from 'zod';

import { LibraryImageFields } from './persona-create.js';
import { AddPersonaImageShape } from './tools.js';
import { MAX_LIBRARY_IMAGE_MB, MAX_SEGMENT_MEDIA_MB } from './limits.js';

export const UploadMediaRemoteShape = {
  imageUrl: z
    .string()
    .url()
    .describe(`Public https URL of the image (JPG/JPEG, PNG, or WebP, max ${MAX_SEGMENT_MEDIA_MB}MB). The server downloads it once and returns a mediaId for a segment (a temporary asset, 1 hour).`),
};

export const AddPersonaImageRemoteShape = {
  personaId: AddPersonaImageShape.personaId,
  imageUrl: z
    .string()
    .url()
    .describe(`Public https URL of the image (JPG/JPEG, PNG, or WebP, max ${MAX_LIBRARY_IMAGE_MB}MB). The server downloads it and adds it to the persona's image library.`),
  tag: LibraryImageFields.tag,
  description: LibraryImageFields.description,
  isPrimary: AddPersonaImageShape.isPrimary,
};
