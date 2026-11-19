import type { PersonaDefaultAccounts } from './persona-publishing-accounts';

export interface PersonaRecord {
  id: string;
  name: string;
  createdAt: string;
  avatarUrl?: string;
  photoUrl?: string;
  libraryUrl?: string;
  voiceId?: string;
  voiceAudioUrl?: string;
  language?: string;
  videoAspect?: string;
  videoLayout?: string;
  scriptPrompt?: string;
  ctaType?: string;
  ctaUrl?: string;
  ctaInstruction?: string;
  paragraphNumber?: number;
  niche?: string;
  faceQuality?: string;
  boundAccounts?: PersonaDefaultAccounts;
}
