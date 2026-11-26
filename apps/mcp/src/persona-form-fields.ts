import type { CreatePersonaInput, UpdatePersonaInput } from './client-types.js';

export function appendCreatePersonaFields(formData: FormData, input: CreatePersonaInput): void {
  formData.set('name', input.name);
  if (input.identityCard !== undefined) formData.set('identityCard', JSON.stringify(input.identityCard));
}

export function appendUpdatePersonaFields(formData: FormData, input: UpdatePersonaInput): void {
  if (input.identityCard !== undefined) formData.set('identityCard', JSON.stringify(input.identityCard));
}
