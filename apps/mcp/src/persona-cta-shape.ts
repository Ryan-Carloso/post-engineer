import { z } from 'zod';

import {
  PERSONA_CTA_INSTRUCTION_MAX_LENGTH,
  PERSONA_CTA_TYPES,
  PERSONA_CTA_URL_MAX_LENGTH,
} from './contracts/personas.js';

export const PersonaCtaShape = z
  .object({
    type: z.enum(PERSONA_CTA_TYPES),
    url: z.string().url().max(PERSONA_CTA_URL_MAX_LENGTH).optional(),
    instruction: z.string().min(1).max(PERSONA_CTA_INSTRUCTION_MAX_LENGTH).optional(),
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

export function appendPersonaCtaFields(
  formData: FormData,
  cta: PersonaCtaInput | undefined,
): void {
  if (cta === undefined) return;
  formData.set('ctaType', cta.type);
  if (cta.url !== undefined) formData.set('ctaUrl', cta.url);
  if (cta.instruction !== undefined) formData.set('ctaInstruction', cta.instruction);
}
