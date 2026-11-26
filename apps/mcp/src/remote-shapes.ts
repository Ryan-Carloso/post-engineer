import { z } from 'zod';

import { UpdatePersonaShape } from './persona-update.js';
import { CreatePersonaShape } from './tools.js';

export const CreatePersonaRemoteShape = {
  name: CreatePersonaShape.name,
  aiLabel: CreatePersonaShape.aiLabel,
  identityCard: CreatePersonaShape.identityCard,
  accounts: CreatePersonaShape.accounts,
};

export const CreatePersonaRemoteSchema = z.object(CreatePersonaRemoteShape).strict();

export const UpdatePersonaRemoteShape = {
  personaId: UpdatePersonaShape.personaId,
  name: UpdatePersonaShape.name,
  aiLabel: UpdatePersonaShape.aiLabel,
  identityCard: UpdatePersonaShape.identityCard,
};

export const UpdatePersonaRemoteSchema = z.object(UpdatePersonaRemoteShape).strict();
