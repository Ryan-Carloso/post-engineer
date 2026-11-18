// Per-persona CTA intent (issue #639): the shape every MCP persona and
// generate_video surface shares, so tools.ts stays under the file-size
// ratchet and the definition lives in one place.
//
// The persona stores the intent ONLY: a type plus facts — a URL for
// link/buy, a free-text instruction for other, nothing extra for
// follow/comment/share/save. No wording is stored anywhere: the agent
// writes the CTA words per video from that video's topic and story, and
// marks one content take `cta: true`. The coherence rule mirrors the
// shared contract (PersonaCtaSchema) and the web form; the server
// re-checks it, this fails fast locally.
import { z } from 'zod';

import {
  PERSONA_CTA_INSTRUCTION_MAX_LENGTH,
  PERSONA_CTA_TYPES,
  PERSONA_CTA_URL_MAX_LENGTH,
} from './contracts/personas.js';

export const PersonaCtaShape = z
  .object({
    // No .describe() on these fields, and no .strict(): every description
    // lands in the advertised tools/list payload, which has a hard size
    // budget (index.test.ts pins it 40% below the endpoint-mirror tools).
    // The coherence rule below reports the exact requirement when the
    // agent gets it wrong, and the contract schema is non-strict too, so
    // a key the server strips is stripped here as well.
    type: z.enum(PERSONA_CTA_TYPES),
    url: z.string().url().max(PERSONA_CTA_URL_MAX_LENGTH).optional(),
    instruction: z.string().max(PERSONA_CTA_INSTRUCTION_MAX_LENGTH).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'link' || value.type === 'buy') {
      if (value.url === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: `A ${value.type} CTA needs a URL.` });
      }
      if (value.instruction !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['instruction'], message: `A ${value.type} CTA takes a URL, not an instruction.` });
      }
      return;
    }
    if (value.type === 'other') {
      if (value.instruction === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['instruction'], message: 'An other CTA needs an instruction.' });
      }
      if (value.url !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'An other CTA takes an instruction, not a URL.' });
      }
      return;
    }
    if (value.url !== undefined || value.instruction !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['type'],
        message: 'A follow, comment, share or save CTA takes no URL or instruction.',
      });
    }
  });

export type PersonaCtaInput = z.infer<typeof PersonaCtaShape>;

/**
 * Flatten a CTA intent onto persona FormData (create/PATCH): the web
 * route reads flat ctaType/ctaUrl/ctaInstruction fields. Only provided
 * facts are sent — an absent fact leaves the stored value untouched on
 * update, and an absent cta sends nothing at all.
 */
export function appendPersonaCtaFields(
  formData: FormData,
  cta: PersonaCtaInput | undefined,
): void {
  if (cta === undefined) return;
  formData.set('ctaType', cta.type);
  if (cta.url !== undefined) formData.set('ctaUrl', cta.url);
  if (cta.instruction !== undefined) formData.set('ctaInstruction', cta.instruction);
}
