import type { SocialProvider } from './contracts/providers.js';
import type { IdentityCard } from './contracts/persona-identity-card.js';

export interface PostEngineerClientOptions {
  apiKey?: string;
  baseUrl?: string;
  now?: () => Date;
  suppressVersionHeader?: boolean;
}

export interface CreatePersonaInput {
  name: string;
  aiLabel?: boolean;
  avatarPath?: string;
  identityCard?: IdentityCard | null;
  accounts: Record<string, string[]>;
}

export interface UpdatePersonaInput {
  personaId: string;
  name?: string;
  aiLabel?: boolean;
  avatarPath?: string;
  identityCard?: IdentityCard | null;
}

export interface PublishVideoDirectInput {
  provider: SocialProvider;
  videoPath: string;
  accountIds: string[];
  title?: string;
  description?: string;
  tags?: string[];
  privacyStatus?: 'public' | 'private' | 'unlisted';
  caption?: string;
  boardId?: string;
  idempotencyKey?: string;
}

export interface PublishUploadedVideoInput {
  provider: SocialProvider;
  uploadId: string;
  accountIds: string[];
  title?: string;
  description?: string;
  tags?: string[];
  privacyStatus?: 'public' | 'private' | 'unlisted';
  caption?: string;
  boardId?: string;
}

export interface MintedVideoUpload {
  uploadId: string;
  signedUrl: string;
  token: string;
  expiresAt: string;
  maxBytes: number;
}

export interface CompletedVideoUpload {
  uploadId: string;
  status: 'ready';
  contentType: string;
  sizeBytes: number;
}

export interface PublishExistingInput {
  media:
    | { kind: 'upload'; uploadId: string }
    | { kind: 'image'; imageData: string; contentType: 'image/jpeg' | 'image/png' };
  accounts: Partial<Record<SocialProvider, string[]>>;
  title: string;
  description: string;
  caption?: string;
  personaId?: string;
  mode: 'asap' | 'scheduled';
  publishAt?: string;
  timezone: string;
  tags?: string[];
  privacyStatus?: 'public' | 'private' | 'unlisted';
  boardId?: string;
  promptVersionId?: string;
  idempotencyKey: string;
}

export interface PublishExistingSlot {
  id: string;
  slot_at: string;
  title: string;
  status: string;
}

export interface PublishExistingReconnectWarning {
  code: 'account_needs_reconnect';
  accounts: Array<{ provider: string; accountId: string }>;
}

export type PublishExistingResult =
  | {
      mode: 'scheduled';
      success: true;
      replayed: boolean;
      scheduleId: string;
      slots: PublishExistingSlot[];
      warnings?: PublishExistingReconnectWarning[];
    }
  | {
      mode: 'asap';
      success: boolean;
      replayed: boolean;
      held: false;
      mediaKind: 'upload' | 'image';
      publishes: Array<{ provider: string; success: boolean; results: DirectPublishAccountResult[] }>;
      logId: string;
    }
  | {
      mode: 'asap';
      success: true;
      replayed: boolean;
      held: true;
      approvalRequired: true;
      slot: { id: string; slotAt: string; status: string };
    }
  | {
      mode: 'asap';
      success: true;
      replayed: boolean;
      held: false;
      approvalRequired: false;
      slot: { id: string; slotAt: string; status: string };
    };

export interface DirectPublishAccountResult {
  accountId: string;
  success: boolean;
  videoId?: string;
  videoUrl?: string;
  postId?: string;
  permalink?: string;
  error?: string;
  errorCode?: string;
}

export interface DirectPublishResult {
  success: boolean;
  provider: string;
  results: DirectPublishAccountResult[];
  successCount: number;
  logId: string;
}
