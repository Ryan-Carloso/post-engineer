import { validateScheduleAdvance } from './validator.js';

export interface PostEngineerClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

export interface CreatePersonaInput {
  name: string;
  avatarUrl?: string | null;
  voiceId?: string;
  language?: string;
  videoAspect?: '9:16' | '16:9';
  scriptPrompt?: string;
  paragraphNumber?: number;
  niche?: string;
  faceMixPercent?: number;
  faceQuality?: 'ok' | 'very_good';
}

export interface GenerateVideoJobInput {
  personaId: string;
  scriptPrompt?: string;
  audioUrl?: string;
}

export interface UpdatePersonaInput {
  personaId: string;
  name?: string;
  avatarUrl?: string;
  voiceId?: string;
  language?: string;
  videoAspect?: '9:16' | '16:9';
  scriptPrompt?: string;
  paragraphNumber?: number;
  niche?: string;
}

export interface CreateScheduleInput {
  personaId: string;
  providers: ('youtube' | 'instagram' | 'linkedin')[];
  youtubeAccountIds?: string[];
  instagramAccountIds?: string[];
  linkedinAccountIds?: string[];
  scheduledAt?: string | Date;
  daysOfWeek?: number[];
  startHour?: number;
  endHour?: number;
  postsPerDay?: number;
  timezone?: string;
  _nowForTesting?: Date;
}

const PRODUCTION_API_URL = 'https://post-engineer.com';
// Hung requests must not block the stdio tool call (and the agent session) forever.
const REQUEST_TIMEOUT_MS = 30_000;
// Bound how much of an upstream error body can flow into agent-visible output.
const MAX_ERROR_BODY_CHARS = 200;

// The bearer key is sent to this URL, so fail fast on a malformed or
// non-http(s) override instead of silently targeting it.
function resolveBaseUrl(override: string | undefined): string {
  const raw = override ?? PRODUCTION_API_URL;
  let protocol: string;
  try {
    protocol = new URL(raw).protocol;
  } catch {
    throw new Error(`Invalid POST_ENGINEER_API_URL: ${raw}`);
  }
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new Error(`Invalid POST_ENGINEER_API_URL (must be http(s)): ${raw}`);
  }
  return raw;
}

export class PostEngineerClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options: PostEngineerClientOptions = {}) {
    this.baseUrl = resolveBaseUrl(options.baseUrl ?? process.env.POST_ENGINEER_API_URL);
    this.apiKey = options.apiKey;
  }

  private getHeaders(includeContentType = true): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (includeContentType) headers['Content-Type'] = 'application/json';
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private async request(path: string, init: RequestInit, action: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to ${action}: ${response.status} ${errorText.slice(0, MAX_ERROR_BODY_CHARS)}`);
    }

    return response.json();
  }

  async createPersona(input: CreatePersonaInput): Promise<unknown> {
    const formData = new FormData();
    const hasAvatar = input.avatarUrl !== undefined && input.avatarUrl !== null && input.avatarUrl.length > 0;
    formData.set('name', input.name);
    formData.set('personaMode', hasAvatar ? 'persona' : 'faceless');
    if (hasAvatar && input.avatarUrl) formData.set('avatarUrl', input.avatarUrl);
    formData.set('voiceId', input.voiceId ?? 'alloy');
    formData.set('language', input.language ?? 'en-US');
    formData.set('videoAspect', input.videoAspect ?? '9:16');
    if (input.scriptPrompt !== undefined) formData.set('scriptPrompt', input.scriptPrompt);
    formData.set('paragraphNumber', String(input.paragraphNumber ?? 1));
    formData.set('niche', input.niche ?? 'General');
    formData.set('faceMixPercent', String(hasAvatar ? input.faceMixPercent ?? 50 : 0));
    formData.set('faceQuality', hasAvatar ? input.faceQuality ?? 'very_good' : 'ok');
    return this.request(
      '/api/persona',
      { method: 'POST', headers: this.getHeaders(false), body: formData },
      'create persona'
    );
  }

  async listPersonas(): Promise<unknown> {
    return this.request(
      '/api/persona/list',
      { method: 'GET', headers: this.getHeaders() },
      'list personas'
    );
  }

  async listVoices(): Promise<unknown> {
    return this.request(
      '/api/persona/voices',
      { method: 'GET', headers: this.getHeaders() },
      'list voices'
    );
  }

  async listFaces(): Promise<unknown> {
    return this.request(
      '/api/persona/faces',
      { method: 'GET', headers: this.getHeaders() },
      'list faces'
    );
  }

  async updatePersona(input: UpdatePersonaInput): Promise<unknown> {
    const formData = new FormData();
    if (input.name !== undefined) formData.set('name', input.name);
    if (input.avatarUrl !== undefined && input.avatarUrl.length > 0) formData.set('avatarUrl', input.avatarUrl);
    if (input.voiceId !== undefined) formData.set('voiceId', input.voiceId);
    if (input.language !== undefined) formData.set('language', input.language);
    if (input.videoAspect !== undefined) formData.set('videoAspect', input.videoAspect);
    if (input.scriptPrompt !== undefined) formData.set('scriptPrompt', input.scriptPrompt);
    if (input.paragraphNumber !== undefined) formData.set('paragraphNumber', String(input.paragraphNumber));
    if (input.niche !== undefined) formData.set('niche', input.niche);
    return this.request(
      `/api/persona?personaId=${encodeURIComponent(input.personaId)}`,
      { method: 'PATCH', headers: this.getHeaders(false), body: formData },
      'update persona'
    );
  }

  async listSocialAccounts(): Promise<unknown> {
    return this.request(
      '/api/account',
      { method: 'GET', headers: this.getHeaders() },
      'list social accounts'
    );
  }

  async getOAuthConnectUrl(provider: string): Promise<unknown> {
    return this.request(
      '/api/account/connect-url',
      { method: 'POST', headers: this.getHeaders(), body: JSON.stringify({ provider }) },
      'get OAuth connect URL'
    );
  }

  async connectBlueskyAccount(handle: string, appPassword: string): Promise<unknown> {
    return this.request(
      '/api/bluesky-connect',
      { method: 'POST', headers: this.getHeaders(), body: JSON.stringify({ handle, appPassword }) },
      'connect Bluesky account'
    );
  }

  async listSchedules(): Promise<unknown> {
    return this.request(
      '/api/schedule',
      { method: 'GET', headers: this.getHeaders() },
      'list schedules'
    );
  }

  async listPosts(limit = 20): Promise<unknown> {
    return this.request(
      `/api/schedule/status?limit=${encodeURIComponent(String(limit))}`,
      { method: 'GET', headers: this.getHeaders() },
      'list posts'
    );
  }

  async cancelSchedule(scheduleId: string): Promise<unknown> {
    return this.request(
      `/api/schedule?id=${encodeURIComponent(scheduleId)}`,
      { method: 'DELETE', headers: this.getHeaders() },
      'cancel schedule'
    );
  }

  async getTokenBalance(): Promise<unknown> {
    return this.request(
      '/api/billing/tokens',
      { method: 'GET', headers: this.getHeaders() },
      'get token balance'
    );
  }

  async generateVideoJob(input: GenerateVideoJobInput): Promise<unknown> {
    return this.request(
      '/api/persona/video-job',
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          personaId: input.personaId,
          video_script_prompt: input.scriptPrompt,
          audio_url: input.audioUrl,
        }),
      },
      'generate video job'
    );
  }

  async getVideoStatus(taskId: string): Promise<unknown> {
    return this.request(
      `/api/persona/video-status/${encodeURIComponent(taskId)}`,
      { method: 'GET', headers: this.getHeaders() },
      'get video status'
    );
  }

  async createSchedule(input: CreateScheduleInput): Promise<unknown> {
    if (input.scheduledAt) {
      const validation = validateScheduleAdvance(input.scheduledAt, input._nowForTesting);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }
    }

    return this.request(
      '/api/schedule',
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          personaId: input.personaId,
          providers: input.providers,
          youtubeAccountIds: input.youtubeAccountIds ?? [],
          instagramAccountIds: input.instagramAccountIds ?? [],
          linkedinAccountIds: input.linkedinAccountIds ?? [],
          scheduledAt: input.scheduledAt,
          daysOfWeek: input.daysOfWeek,
          startHour: input.startHour,
          endHour: input.endHour,
          postsPerDay: input.postsPerDay,
          timezone: input.timezone ?? 'UTC',
        }),
      },
      'create schedule'
    );
  }
}
