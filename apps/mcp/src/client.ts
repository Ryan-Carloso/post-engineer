import { apiErrorFromResponse } from './errors.js';
import { redactSecretFromError } from './secret-redaction.js';
import { MAX_UPLOAD_VIDEO_BYTES, MAX_UPLOAD_VIDEO_GB } from './limits.js';

export { MAX_UPLOAD_VIDEO_BYTES, MAX_UPLOAD_VIDEO_GB };

import type {
  CreatePersonaInput,
  DirectPublishResult,
  PostEngineerClientOptions,
  PublishVideoDirectInput,
  UpdatePersonaInput,
} from './client-types.js';
import { requirePublishingAccounts } from './require-publishing-accounts.js';
import { resolveBaseUrl } from './client-base-url.js';
import { appendCreatePersonaFields, appendUpdatePersonaFields } from './persona-form-fields.js';
import { publishVideoDirect } from './client-publish-uploaded.js';
import type { ResponseOf } from './contracts/endpoint.js';
import { parseContractResponse } from './contract-response.js';
import {
  connectBlueskyAccount as connectBlueskyAccountContract,
  connectRumbleAccount as connectRumbleAccountContract,
  connectThreespeakAccount as connectThreespeakAccountContract,
  disconnectAccount as disconnectAccountContract,
  getOAuthConnectUrl as getOAuthConnectUrlContract,
  listSocialAccounts as listSocialAccountsContract,
} from './contracts/accounts.js';
import {
  cancelSchedule as cancelScheduleContract,
  deleteSlot as deleteSlotContract,
  getSlot as getSlotContract,
  listPosts as listPostsContract,
  listSchedules as listSchedulesContract,
  updateSlotTitle as updateSlotTitleContract,
} from './contracts/schedule.js';
import { isSocialProvider, SOCIAL_PROVIDERS } from './contracts/providers.js';
import {
  createPersona as createPersonaContract,
  deletePersona as deletePersonaContract,
  getPersonaDeletePreview as getPersonaDeletePreviewContract,
  listPersonas as listPersonasContract,
  updatePersona as updatePersonaContract,
} from './contracts/personas.js';

export type {
  CreatePersonaInput,
  DirectPublishAccountResult,
  DirectPublishResult,
  PostEngineerClientOptions,
  PublishVideoDirectInput,
  UpdatePersonaInput,
} from './client-types.js';
import { requireTitle } from './require-title.js';
import { mcpTelemetryHeaders } from './analytics.js';

const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;

import { appendPersonaAvatar } from './persona-avatar.js';

export class PostEngineerClient {
  readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly now: () => Date;
  private readonly suppressVersionHeader: boolean;
  constructor(options: PostEngineerClientOptions = {}) {
    this.baseUrl = resolveBaseUrl(options.baseUrl ?? process.env.POST_ENGINEER_API_URL);
    this.apiKey = options.apiKey; this.suppressVersionHeader = options.suppressVersionHeader ?? false;
    this.now = options.now ?? (() => new Date());
  }

  getHeaders(includeContentType = true): Record<string, string> {
    const headers: Record<string, string> = { ...mcpTelemetryHeaders({ includeVersion: !this.suppressVersionHeader }), Accept: 'application/json' };
    if (includeContentType) headers['Content-Type'] = 'application/json';
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  async request(
    path: string,
    init: RequestInit,
    action: string,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) throw await apiErrorFromResponse(response, action);

    if (response.status === 204) return { ok: true };
    const successText = await response.text();
    if (successText.length === 0) return { ok: true };
    try {
      return JSON.parse(successText) as unknown;
    } catch {
      throw new Error(`Failed to ${action}: response was not valid JSON (status ${response.status}).`);
    }
  }

  async createPersona(input: CreatePersonaInput): Promise<ResponseOf<typeof createPersonaContract>> {
    const formData = new FormData();
    formData.set('publishingAccounts', JSON.stringify(requirePublishingAccounts(input.accounts)));
    await appendPersonaAvatar(formData, input);
    appendCreatePersonaFields(formData, input);
    const raw = await this.request(
      '/api/persona',
      { method: 'POST', headers: this.getHeaders(false), body: formData },
      'create persona',
      UPLOAD_TIMEOUT_MS,
    );
    return parseContractResponse(createPersonaContract, raw);
  }

  async listPersonas(): Promise<ResponseOf<typeof listPersonasContract>> {
    const raw = await this.request(
      '/api/persona/list',
      { method: 'GET', headers: this.getHeaders() },
      'list personas'
    );
    return parseContractResponse(listPersonasContract, raw);
  }

  async updatePersona(input: UpdatePersonaInput): Promise<ResponseOf<typeof updatePersonaContract>> {
    const formData = new FormData();
    if (input.name !== undefined) formData.set('name', input.name);
    await appendPersonaAvatar(formData, input);
    appendUpdatePersonaFields(formData, input);
    const raw = await this.request(
      `/api/persona?personaId=${encodeURIComponent(input.personaId)}`,
      { method: 'PATCH', headers: this.getHeaders(false), body: formData },
      'update persona'
    );
    return parseContractResponse(updatePersonaContract, raw);
  }

  async listSocialAccounts(): Promise<ResponseOf<typeof listSocialAccountsContract>> {
    const raw = await this.request(
      '/api/account',
      { method: 'GET', headers: this.getHeaders() },
      'list social accounts'
    );
    return parseContractResponse(listSocialAccountsContract, raw);
  }

  async getOAuthConnectUrl(provider: string): Promise<ResponseOf<typeof getOAuthConnectUrlContract>> {
    const raw = await this.request(
      '/api/account/connect-url',
      { method: 'POST', headers: this.getHeaders(), body: JSON.stringify({ provider }) },
      'get OAuth connect URL'
    );
    return parseContractResponse(getOAuthConnectUrlContract, raw);
  }

  async connectBlueskyAccount(handle: string, appPassword: string): Promise<ResponseOf<typeof connectBlueskyAccountContract>> {
    const endpoint = '/api/bluesky-connect';
    try {
      const raw = await this.request(endpoint, { method: 'POST', headers: this.getHeaders(), body: JSON.stringify({ handle, appPassword }) }, 'connect Bluesky account');
      return parseContractResponse(connectBlueskyAccountContract, raw);
    } catch (error) {
      throw redactSecretFromError(error, appPassword);
    }
  }

  async connectThreespeakAccount(username: string, postingKey: string): Promise<ResponseOf<typeof connectThreespeakAccountContract>> {
    const endpoint = '/api/threespeak-connect';
    try {
      const raw = await this.request(endpoint, { method: 'POST', headers: this.getHeaders(), body: JSON.stringify({ username, postingKey }) }, 'connect 3Speak account');
      return parseContractResponse(connectThreespeakAccountContract, raw);
    } catch (error) {
      throw redactSecretFromError(error, postingKey);
    }
  }

  async connectRumbleAccount(channelId: string, accessToken: string): Promise<ResponseOf<typeof connectRumbleAccountContract>> {
    try {
      const raw = await this.request(
        '/api/rumble-connect',
        { method: 'POST', headers: this.getHeaders(), body: JSON.stringify({ channelId, accessToken }) },
        'connect Rumble account',
      );
      return parseContractResponse(connectRumbleAccountContract, raw);
    } catch (error) {
      throw redactSecretFromError(error, accessToken);
    }
  }

  async listSchedules(): Promise<ResponseOf<typeof listSchedulesContract>> {
    const raw = await this.request(
      '/api/schedule',
      { method: 'GET', headers: this.getHeaders() },
      'list schedules'
    );
    return parseContractResponse(listSchedulesContract, raw);
  }

  async listPosts(limit = 20): Promise<ResponseOf<typeof listPostsContract>> {
    const raw = await this.request(
      `/api/schedule/status?limit=${encodeURIComponent(String(limit))}`,
      { method: 'GET', headers: this.getHeaders() },
      'list posts'
    );
    return parseContractResponse(listPostsContract, raw);
  }

  async cancelSchedule(scheduleId: string): Promise<ResponseOf<typeof cancelScheduleContract>> {
    const raw = await this.request(
      `/api/schedule?id=${encodeURIComponent(scheduleId)}`,
      { method: 'DELETE', headers: this.getHeaders() },
      'cancel schedule'
    );
    return parseContractResponse(cancelScheduleContract, raw);
  }

  async getSlot(slotId: string): Promise<ResponseOf<typeof getSlotContract>> {
    const raw = await this.request(
      `/api/schedule/slots/${encodeURIComponent(slotId)}`,
      { method: 'GET', headers: this.getHeaders() },
      'get slot'
    );
    return parseContractResponse(getSlotContract, raw);
  }

  async updateSlotTitle(slotId: string, title: string): Promise<ResponseOf<typeof updateSlotTitleContract>> {
    const trimmed = requireTitle(title);
    const raw = await this.request(
      `/api/schedule/slots/${encodeURIComponent(slotId)}`,
      {
        method: 'PATCH',
        headers: this.getHeaders(),
        body: JSON.stringify({ title: trimmed }),
      },
      'update slot title'
    );
    return parseContractResponse(updateSlotTitleContract, raw);
  }

  async deleteSlot(slotId: string): Promise<ResponseOf<typeof deleteSlotContract>> {
    const raw = await this.request(
      `/api/schedule/slots/${encodeURIComponent(slotId)}`,
      { method: 'DELETE', headers: this.getHeaders() },
      'delete slot'
    );
    return parseContractResponse(deleteSlotContract, raw);
  }

  async getPersonaDeletePreview(personaId: string): Promise<ResponseOf<typeof getPersonaDeletePreviewContract>> {
    const raw = await this.request(
      `/api/persona/delete-preview?personaId=${encodeURIComponent(personaId)}`,
      { method: 'GET', headers: this.getHeaders() },
      'get persona delete preview'
    );
    return parseContractResponse(getPersonaDeletePreviewContract, raw);
  }

  async deletePersona(personaId: string): Promise<ResponseOf<typeof deletePersonaContract>> {
    const raw = await this.request(
      `/api/persona?personaId=${encodeURIComponent(personaId)}`,
      { method: 'DELETE', headers: this.getHeaders() },
      'delete persona'
    );
    return parseContractResponse(deletePersonaContract, raw);
  }

  async disconnectAccount(provider: string, providerAccountId: string): Promise<ResponseOf<typeof disconnectAccountContract>> {
    if (!isSocialProvider(provider)) {
      throw new Error(`provider must be one of: ${SOCIAL_PROVIDERS.join(', ')}.`);
    }
    if (providerAccountId.trim().length === 0) {
      throw new Error('providerAccountId must be a non-empty string.');
    }
    const params = new URLSearchParams({
      provider,
      providerAccountId: providerAccountId.trim(),
    });
    const raw = await this.request(
      `/api/account?${params.toString()}`,
      { method: 'DELETE', headers: this.getHeaders() },
      'disconnect account'
    );
    return parseContractResponse(disconnectAccountContract, raw);
  }

  async publishVideoDirect(input: PublishVideoDirectInput): Promise<DirectPublishResult> {
    return publishVideoDirect(this, input);
  }
}
