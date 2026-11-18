import { ApiError, readApiFailure } from './errors.js';
import { redactSecretFromError } from './secret-redaction.js';
import {
  MAX_LIBRARY_IMAGE_BYTES, MAX_LIBRARY_IMAGE_MB,
  MAX_UPLOAD_VIDEO_BYTES, MAX_UPLOAD_VIDEO_GB, VIDEO_LAYOUTS,
} from './limits.js';

export {
  MAX_LIBRARY_IMAGE_BYTES,
  MAX_LIBRARY_IMAGE_MB,
  MAX_UPLOAD_VIDEO_BYTES,
  MAX_UPLOAD_VIDEO_GB,
  VIDEO_LAYOUTS,
};

import type {
  CreatePersonaInput,
  DirectPublishResult,
  GeneratePersonaVideoInput,
  PersonaLibraryImageInput,
  PostEngineerClientOptions,
  PublishVideoDirectInput,
  UpdatePersonaInput, VideoType,
} from './client-types.js';
import { requirePublishingAccounts } from './require-publishing-accounts.js';
import { publishVideoDirect } from './client-publish-uploaded.js';
import {
  getTokenBalance,
  listTokenTransactions,
} from './client-billing.js';
import type { ResponseOf } from './contracts/endpoint.js';
import { parseContractResponse } from './contract-response.js';
import {
  getTokenBalance as getTokenBalanceContract,
  listTokenTransactions as listTokenTransactionsContract,
} from './contracts/billing.js';
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
import {
  VIDEO_GENERATIONS_MAX_LIMIT,
  getVideoGeneration as getVideoGenerationContract,
  getVideoStatus as getVideoStatusContract,
  listVideoGenerations as listVideoGenerationsContract,
} from './contracts/video-tasks.js';
import {
  listVoices as listVoicesContract,
} from './contracts/voices.js';
import { isSocialProvider, SOCIAL_PROVIDERS } from './contracts/providers.js';
import {
  generateAndSchedule as generateAndScheduleContract,
  validateScript as validateScriptContract,
} from './contracts/videos.js';
import {
  MAX_DESCRIPTION_LENGTH as MAX_LIBRARY_DESCRIPTION_LENGTH,
  MAX_LIBRARY_IMAGES,
  MAX_TAG_LENGTH as MAX_LIBRARY_TAG_LENGTH,
  addPersonaImage as addPersonaImageContract,
  createPersona as createPersonaContract,
  deletePersona as deletePersonaContract,
  deletePersonaImage as deletePersonaImageContract,
  getPersonaDeletePreview as getPersonaDeletePreviewContract,
  listFaces as listFacesContract,
  listPersonaImages as listPersonaImagesContract,
  listPersonas as listPersonasContract,
  updatePersona as updatePersonaContract,
  updatePersonaImage as updatePersonaImageContract,
} from './contracts/personas.js';

export type {
  CreatePersonaInput,
  DirectPublishAccountResult,
  DirectPublishResult,
  GeneratePersonaVideoInput,
  PersonaLibraryImageInput,
  PostEngineerClientOptions,
  PublishVideoDirectInput,
  UpdatePersonaInput,
  VideoLayout,
} from './client-types.js';
import { requireTitle } from './require-title.js';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { mcpTelemetryHeaders } from './analytics.js';

const PRODUCTION_API_URL = 'https://post-engineer.com';
const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;
export {
  MAX_LIBRARY_DESCRIPTION_LENGTH,
  MAX_LIBRARY_IMAGES,
  MAX_LIBRARY_TAG_LENGTH,
};

export { assertImageSize } from './image-guards.js';
export { assertVideoSize } from './client-publish-uploaded.js';
import { appendPersonaAvatar, imageFormFile } from './persona-avatar.js';

function checkLibraryMetadataLengths(
  tag: string | undefined,
  description: string | undefined,
  label?: string,
): void {
  const where = label ? ` for "${label}"` : '';
  if (tag !== undefined && tag.length > MAX_LIBRARY_TAG_LENGTH) {
    throw new Error(`Image tag${where} exceeds ${MAX_LIBRARY_TAG_LENGTH} characters.`);
  }
  if (description !== undefined && description.length > MAX_LIBRARY_DESCRIPTION_LENGTH) {
    throw new Error(
      `Image description${where} exceeds ${MAX_LIBRARY_DESCRIPTION_LENGTH} characters.`,
    );
  }
}

function normalizeLibraryMetadata(
  image: { tag?: string; description?: string },
  label?: string,
): { tag: string; description: string } {
  const tag = image.tag?.trim() ?? '';
  const description = image.description?.trim() ?? '';
  checkLibraryMetadataLengths(tag, description, label);
  return { tag, description };
}

function resolveBaseUrl(override: string | undefined): string {
  const raw = override ?? PRODUCTION_API_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid POST_ENGINEER_API_URL: not an absolute URL (use https:)');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Invalid POST_ENGINEER_API_URL: protocol "${url.protocol}" is not allowed (use https:)`);
  }
  const loopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1' ||
    url.hostname === '[::1]';
  if (url.protocol === 'http:' && !loopback) {
    throw new Error('Invalid POST_ENGINEER_API_URL: http: is only allowed for loopback hosts (use https:)');
  }
  return url.origin + url.pathname.replace(/\/+$/, '');
}

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

    if (!response.ok) {
      const errorText = await response.text();
      const failure = readApiFailure(errorText);
      throw new ApiError(
        `Failed to ${action}: ${response.status} ${failure.detail}`,
        failure.code, failure.field, response.status, failure.delivered, failure.postUrl,
      );
    }

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
    await appendPersonaAvatar(formData, input, true);
    formData.set('name', input.name);
    formData.set('voiceId', input.voiceId);
    formData.set('language', input.language ?? 'en-US');
    formData.set('videoAspect', input.videoAspect ?? '9:16');
    formData.set('videoLayout', input.videoLayout ?? 'standard');
    if (input.scriptPrompt !== undefined) formData.set('scriptPrompt', input.scriptPrompt);
    formData.set('paragraphNumber', String(input.paragraphNumber ?? 1));
    formData.set('niche', input.niche ?? 'General');
    formData.set('faceQuality', input.faceQuality ?? 'very_good');
    const images = input.images ?? [];
    if (input.imagePrimaryIndex !== undefined && images.length === 0) {
      throw new Error('imagePrimaryIndex requires images: provide at least one library image.');
    }
    if (images.length > 0) {
      if (images.length > MAX_LIBRARY_IMAGES) {
        throw new Error(`At most ${MAX_LIBRARY_IMAGES} library images are allowed per persona.`);
      }
      if (input.imagePrimaryIndex !== undefined) {
        if (input.imagePrimaryIndex < 0 || input.imagePrimaryIndex >= images.length) {
          throw new Error(
            `imagePrimaryIndex ${input.imagePrimaryIndex} is out of range: ${images.length} images provided.`,
          );
        }
        formData.set('imagePrimaryIndex', String(input.imagePrimaryIndex));
      }
      const tags: string[] = [];
      const descriptions: string[] = [];
      for (const image of images) {
        const { tag, description } = normalizeLibraryMetadata(image, basename(image.path));
        formData.append('images', await imageFormFile(image.path), basename(image.path));
        tags.push(tag);
        descriptions.push(description);
      }
      formData.set('imageTags', JSON.stringify(tags));
      formData.set('imageDescriptions', JSON.stringify(descriptions));
    }
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

  async listVoices(): Promise<ResponseOf<typeof listVoicesContract>> {
    const raw = await this.request(
      '/api/persona/voices',
      { method: 'GET', headers: this.getHeaders() },
      'list voices'
    );
    return parseContractResponse(listVoicesContract, raw);
  }

  async listFaces(): Promise<ResponseOf<typeof listFacesContract>> {
    const raw = await this.request(
      '/api/persona/faces',
      { method: 'GET', headers: this.getHeaders() },
      'list faces'
    );
    return parseContractResponse(listFacesContract, raw);
  }

  async updatePersona(input: UpdatePersonaInput): Promise<ResponseOf<typeof updatePersonaContract>> {
    const formData = new FormData();
    if (input.name !== undefined) formData.set('name', input.name);
    await appendPersonaAvatar(formData, input, false);
    if (input.voiceId !== undefined) formData.set('voiceId', input.voiceId);
    if (input.language !== undefined) formData.set('language', input.language);
    if (input.videoAspect !== undefined) formData.set('videoAspect', input.videoAspect);
    if (input.videoLayout !== undefined) formData.set('videoLayout', input.videoLayout);
    if (input.scriptPrompt !== undefined) formData.set('scriptPrompt', input.scriptPrompt);
    if (input.paragraphNumber !== undefined) formData.set('paragraphNumber', String(input.paragraphNumber));
    if (input.niche !== undefined) formData.set('niche', input.niche);
    if (input.faceQuality !== undefined) formData.set('faceQuality', input.faceQuality);
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

  async getTokenBalance(): Promise<ResponseOf<typeof getTokenBalanceContract>> {
    return getTokenBalance(this);
  }

  async listVideoGenerations(limit?: number): Promise<ResponseOf<typeof listVideoGenerationsContract>> {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > VIDEO_GENERATIONS_MAX_LIMIT)) {
      throw new Error(`limit must be an integer between 1 and ${VIDEO_GENERATIONS_MAX_LIMIT}.`);
    }
    const query = limit !== undefined ? `?limit=${encodeURIComponent(String(limit))}` : '';
    const raw = await this.request(
      `/api/persona/video-generations${query}`,
      { method: 'GET', headers: this.getHeaders() },
      'list video generations'
    );
    return parseContractResponse(listVideoGenerationsContract, raw);
  }

  async getVideoGeneration(generationId: string): Promise<ResponseOf<typeof getVideoGenerationContract>> {
    const raw = await this.request(
      `/api/persona/video-generations/${encodeURIComponent(generationId)}`,
      { method: 'GET', headers: this.getHeaders() },
      'get video generation'
    );
    return parseContractResponse(getVideoGenerationContract, raw);
  }

  async listTokenTransactions(limit?: number, offset?: number): Promise<ResponseOf<typeof listTokenTransactionsContract>> {
    return listTokenTransactions(this, limit, offset);
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

  async validateScript(segments: unknown, videoType: VideoType = 'hook_lipsync'): Promise<ResponseOf<typeof validateScriptContract>> {
    const raw = await this.request(
      '/api/videos/validate-script',
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ segments, videoType }),
      },
      'validate script'
    );
    return parseContractResponse(validateScriptContract, raw);
  }

  async generatePersonaVideo(input: GeneratePersonaVideoInput): Promise<ResponseOf<typeof generateAndScheduleContract>> {
    const title = requireTitle(input.title);
    const accounts: Record<string, string[]> = {};
    const byProvider = { youtube: input.youtubeAccountIds, instagram: input.instagramAccountIds, linkedin: input.linkedinAccountIds, bluesky: input.blueskyAccountIds, threads: input.threadsAccountIds, facebook: input.facebookAccountIds, pinterest: input.pinterestAccountIds, fanvue: input.fanvueAccountIds, '3speak': input.threespeakAccountIds, rumble: input.rumbleAccountIds };
    for (const [provider, ids] of Object.entries(byProvider)) if (ids !== undefined) accounts[provider] = ids;
    const mode = input.mode ?? 'scheduled';
    if (mode === 'asap' && (input.startAt !== undefined || input.times !== undefined)) {
      throw new Error("startAt and times must not be set when mode is 'asap'.");
    }
    if (mode === 'scheduled' && (input.startAt === undefined || input.times === undefined)) {
      throw new Error("startAt and times are required when mode is 'scheduled'.");
    }
    const raw = await this.request(
      '/api/videos/generate-and-schedule',
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          ...(input.personaId !== undefined ? { personaId: input.personaId } : {}),
          title,
          description: input.description,
          publishing: {
            mode,
            providers: input.providers, ...(input.pinterestBoardId ? { pinterestBoardId: input.pinterestBoardId } : {}),
            accounts,
            ...(mode === 'asap'
              ? { timezone: input.timezone ?? 'UTC' }
              : {
                  schedule: {
                    startAt: input.startAt,
                    times: input.times,
                    timezone: input.timezone ?? 'UTC',
                  },
                }),
          },
          options: input.options ?? undefined,
          ...(input.experiment !== undefined ? { experiment: input.experiment } : {}),
          idempotencyKey: input.idempotencyKey ?? randomUUID(),
        }),
      },
      'generate and schedule video'
    );
    return parseContractResponse(generateAndScheduleContract, raw);
  }

  async getVideoStatus(taskId: string): Promise<ResponseOf<typeof getVideoStatusContract>> {
    const raw = await this.request(
      `/api/persona/video-status/${encodeURIComponent(taskId)}`,
      { method: 'GET', headers: this.getHeaders() },
      'get video status'
    );
    return parseContractResponse(getVideoStatusContract, raw);
  }

  async listPersonaImages(personaId: string): Promise<ResponseOf<typeof listPersonaImagesContract>> {
    const raw = await this.request(
      `/api/persona/images?personaId=${encodeURIComponent(personaId)}`,
      { method: 'GET', headers: this.getHeaders() },
      'list persona images'
    );
    return parseContractResponse(listPersonaImagesContract, raw);
  }

  async addPersonaImage(
    personaId: string,
    image: PersonaLibraryImageInput & { isPrimary?: true }
  ): Promise<ResponseOf<typeof addPersonaImageContract>> {
    const formData = new FormData();
    formData.set('personaId', personaId);
    formData.append('image', await imageFormFile(image.path), basename(image.path));
    const { tag, description } = normalizeLibraryMetadata(image);
    if (tag) formData.set('tag', tag);
    if (description) formData.set('description', description);
    if (image.isPrimary) formData.set('isPrimary', 'true');
    const raw = await this.request(
      '/api/persona/images',
      { method: 'POST', headers: this.getHeaders(false), body: formData },
      'add persona image',
      UPLOAD_TIMEOUT_MS,
    );
    return parseContractResponse(addPersonaImageContract, raw);
  }

  async updatePersonaImage(input: {
    id: string;
    tag?: string;
    description?: string;
    isPrimary?: boolean;
  }): Promise<ResponseOf<typeof updatePersonaImageContract>> {
    if (
      input.tag === undefined &&
      input.description === undefined &&
      input.isPrimary === undefined
    ) {
      throw new Error('updatePersonaImage requires at least one of tag, description, or isPrimary.');
    }
    if (input.isPrimary === false) {
      throw new Error(
        'updatePersonaImage: isPrimary cannot be false — mark another image as primary instead (the swap atomically demotes the old one).'
      );
    }
    const tag = input.tag?.trim();
    const description = input.description?.trim();
    checkLibraryMetadataLengths(tag, description);
    const raw = await this.request(
      '/api/persona/images',
      {
        method: 'PATCH',
        headers: this.getHeaders(),
        body: JSON.stringify({
          id: input.id,
          ...(tag !== undefined ? { tag } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
        }),
      },
      'update persona image'
    );
    return parseContractResponse(updatePersonaImageContract, raw);
  }

  async deletePersonaImage(id: string): Promise<ResponseOf<typeof deletePersonaImageContract>> {
    const raw = await this.request(
      `/api/persona/images?id=${encodeURIComponent(id)}`,
      { method: 'DELETE', headers: this.getHeaders() },
      'delete persona image'
    );
    return parseContractResponse(deletePersonaImageContract, raw);
  }

  async publishVideoDirect(input: PublishVideoDirectInput): Promise<DirectPublishResult> {
    return publishVideoDirect(this, input);
  }
}
