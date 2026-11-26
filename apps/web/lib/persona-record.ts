import type { PersonaDefaultAccounts } from './persona-publishing-accounts';

export interface PersonaRecord {
  id: string;
  name: string;
  createdAt: string;
  avatarUrl?: string;
  photoUrl?: string;
  boundAccounts?: PersonaDefaultAccounts;
}
