import { z } from 'zod';

import { createPersonaAccountsField } from './account-shapes.js';
import { PersonaAvatarFields } from './persona-avatar.js';
import { IdentityCardField } from './persona-card-actions.js';

export const CreatePersonaShape = {
  name: z.string().min(1, 'Name is required').describe('Name of the persona'),
  ...PersonaAvatarFields,
  identityCard: IdentityCardField.nullable().optional().describe('The identity card to store. null stores none (the same as leaving it out).'),
  accounts: createPersonaAccountsField,
};

export const CreatePersonaSchema = z.object(CreatePersonaShape);
