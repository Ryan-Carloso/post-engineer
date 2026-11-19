import type { PersonaCtaType } from '@/lib/contracts/personas';

export interface ResolvedCta {
  type: PersonaCtaType;
  url: string | null;
  instruction: string | null;
}

export function resolveEffectiveCta(
  override: { type: PersonaCtaType; url?: string; instruction?: string } | null | undefined,
  personaCta: ResolvedCta | null,
): ResolvedCta | null {
  if (override === null) return null;
  if (override !== undefined) {
    return { type: override.type, url: override.url ?? null, instruction: override.instruction ?? null };
  }
  return personaCta;
}

export type CtaTakeCheck =
  | { ok: true }
  | { ok: false; message: string; field: string };

export function validateCtaTake(
  cta: ResolvedCta | null,
  segments: Array<{ kind: string; text: string; cta?: boolean }> | undefined,
): CtaTakeCheck {
  const marked = (segments ?? []).filter((segment) => segment.cta === true);
  if (cta === null) {
    if (marked.length > 0) {
      return {
        ok: false,
        message: 'A take is marked as the CTA take but the CTA is disabled for this video.',
        field: 'options.segments',
      };
    }
    return { ok: true };
  }
  if (marked.length === 0) {
    return {
      ok: false,
      message: 'This video needs a CTA take: mark the content take that performs the persona CTA with cta: true.',
      field: 'options.segments',
    };
  }
  for (const segment of marked) {
    if (segment.kind !== 'content') {
      return {
        ok: false,
        message: 'The hook cannot be the CTA take: mark a content take with cta: true.',
        field: 'options.segments',
      };
    }
    if (cta.type === 'comment' && !segment.text.includes('?')) {
      return {
        ok: false,
        message: "A comment CTA must ask a question: end the marked take with a question about this video's topic.",
        field: 'options.segments',
      };
    }
  }
  return { ok: true };
}
