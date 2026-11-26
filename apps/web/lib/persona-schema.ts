import { z } from 'zod';
import {
  parsePublishingAccountsField,
  type PersonaDefaultAccounts,
} from './persona-publishing-accounts';
import { AI_LABEL_FORM_VALUES, invalidAiLabelMessage } from './ai-label-form';
import type { IdentityCard } from './contracts/persona-identity-card';
import { parseIdentityCardField } from '@/app/api/persona/identity-card-field';

export const PHOTO_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const optionalText = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

export const personaFormSchema = z.object({
  name: optionalText(z.string().trim().min(1)),
  aiLabel: optionalText(z.enum(AI_LABEL_FORM_VALUES)),
});

const FIELD_ERRORS: Record<string, (value: unknown) => string> = {
  aiLabel: (value) => invalidAiLabelMessage(value),
};

function fieldErrorMessage(error: z.ZodError, entries: Record<string, unknown>): string {
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '');
    const builder = FIELD_ERRORS[key];
    if (builder) return builder(entries[key]);
  }
  return 'Invalid persona form payload.';
}

export type PersonaFormMode = 'create' | 'debug';

export type PersonaFormValues = z.infer<typeof personaFormSchema>;

export type ParsedPersonaForm = {
  values: {
    name: string;
    aiLabel: boolean | null;
    identityCard: IdentityCard | null;
    publishingAccounts: PersonaDefaultAccounts;
  };
  photo: File | null;
  photoExtension: string | null;
};

export type ParsePersonaFormResult =
  | { ok: true; value: ParsedPersonaForm }
  | { ok: false; error: string };

export function photoExtensionOf(photo: File | null): string | null {
  return photo ? (PHOTO_EXTENSIONS[photo.type] ?? null) : null;
}

function fileFrom(formData: FormData, key: string): File | null {
  const value = formData.get(key);
  return value instanceof File ? value : null;
}

export function parsePersonaForm(formData: FormData, mode?: PersonaFormMode): ParsePersonaFormResult {
  void mode;
  const entries = Object.fromEntries(
    Array.from(formData.entries()).filter(([, value]) => typeof value === 'string'),
  );
  const parsed = personaFormSchema.safeParse(entries);
  if (!parsed.success) {
    return { ok: false, error: fieldErrorMessage(parsed.error, entries) };
  }
  const values = parsed.data;

  const photo = fileFrom(formData, 'photo');
  if (photo && photoExtensionOf(photo) === null) {
    return { ok: false, error: `Unsupported photo format: ${photo.type}` };
  }

  if (!values.name) {
    return { ok: false, error: 'Persona name is required.' };
  }
  const binding = parsePublishingAccountsField(formData.get('publishingAccounts'));
  if (!binding.ok) {
    return { ok: false, error: binding.error };
  }

  const identityCard = parseIdentityCardField(formData.get('identityCard'));
  if (identityCard.status === 'invalid') {
    return { ok: false, error: identityCard.error };
  }

  return {
    ok: true,
    value: {
      values: {
        name: values.name,
        aiLabel: values.aiLabel === undefined ? null : values.aiLabel === 'true',
        identityCard: identityCard.status === 'set' ? identityCard.card : null,
        publishingAccounts: binding.accounts,
      },
      photo,
      photoExtension: photoExtensionOf(photo),
    },
  };
}
