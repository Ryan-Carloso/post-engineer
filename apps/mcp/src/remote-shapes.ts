import { z } from 'zod';

import { UpdatePersonaShape } from './persona-update.js';
import { CreatePersonaShape } from './tools.js';

export const CreatePersonaRemoteShape = {
  name: CreatePersonaShape.name,
  identityCard: CreatePersonaShape.identityCard,
  accounts: CreatePersonaShape.accounts,
};

export const CreatePersonaRemoteSchema = z.object(CreatePersonaRemoteShape).strict();

export const UpdatePersonaRemoteShape = {
  personaId: UpdatePersonaShape.personaId,
  name: UpdatePersonaShape.name,
  identityCard: UpdatePersonaShape.identityCard,
};

export const UpdatePersonaRemoteSchema = z.object(UpdatePersonaRemoteShape).strict();
