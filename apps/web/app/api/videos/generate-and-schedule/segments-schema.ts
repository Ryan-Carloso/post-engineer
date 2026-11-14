// Request shape of `segments` for generate-and-schedule (MCP first,
// Phase 1): one call = one video. Strict at every level so an unknown key
// is a 400, never silently dropped. Content rules (word counts) live in
// the shared validator; this pins the shape plus the segment-count cap
// (MAX_SEGMENTS, the same constant) so an oversized array is a 400 before
// those checks run. Kept next to the route because the route file may not
// grow (file-size ratchet).
import { z } from 'zod';

import { MAX_IMAGES_MODE_MEDIAS, MAX_SEGMENTS } from '@/lib/generation/script-segments';

export const segmentOverlaySchema = z
  .object({
    title: z.string(),
    subtitle: z.string().optional(),
    badge: z.string().optional(),
  })
  .strict();

export const segmentsRequestSchema = z.array(
  z
    .object({
      kind: z.enum(['hook', 'content']),
      text: z.string(),
      media: z
        .array(
          z
            .object({
              mediaId: z.string().optional(),
              url: z.string().optional(),
              overlay: segmentOverlaySchema.optional(),
            })
            .strict(),
        )
        .max(MAX_IMAGES_MODE_MEDIAS)
        .optional(),
    })
    .strict(),
).max(MAX_SEGMENTS);
