import { validateScheduleAdvance } from './validator.js';

export interface PostEngineerClientOptions {
  apiKey?: string;
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
  avatarUrl?: string | null;
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

export class PostEngineerClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(options: PostEngineerClientOptions = {}) {
    this.baseUrl = PRODUCTION_API_URL;
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

  async createPersona(input: CreatePersonaInput): Promise<unknown> {
    const url = `${this.baseUrl}/api/persona`;
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
    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(false),
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create persona: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async listPersonas(): Promise<unknown> {
    const url = `${this.baseUrl}/api/persona/list`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list personas: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async listVoices(): Promise<unknown> {
    const url = `${this.baseUrl}/api/persona/voices`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list voices: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async listFaces(): Promise<unknown> {
    const url = `${this.baseUrl}/api/persona/faces`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list faces: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async updatePersona(input: UpdatePersonaInput): Promise<unknown> {
    const url = `${this.baseUrl}/api/persona?personaId=${encodeURIComponent(input.personaId)}`;
    const formData = new FormData();
    if (input.name !== undefined) formData.set('name', input.name);
    if (input.avatarUrl !== undefined && input.avatarUrl !== null) formData.set('avatarUrl', input.avatarUrl);
    if (input.voiceId !== undefined) formData.set('voiceId', input.voiceId);
    if (input.language !== undefined) formData.set('language', input.language);
    if (input.videoAspect !== undefined) formData.set('videoAspect', input.videoAspect);
    if (input.scriptPrompt !== undefined) formData.set('scriptPrompt', input.scriptPrompt);
    if (input.paragraphNumber !== undefined) formData.set('paragraphNumber', String(input.paragraphNumber));
    if (input.niche !== undefined) formData.set('niche', input.niche);
    const response = await fetch(url, {
      method: 'PATCH',
      headers: this.getHeaders(false),
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update persona: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async listSocialAccounts(): Promise<unknown> {
    const url = `${this.baseUrl}/api/account`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list social accounts: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async getOAuthConnectUrl(provider: string): Promise<unknown> {
    const url = `${this.baseUrl}/api/account/connect-url`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ provider }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get OAuth connect URL: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async connectBlueskyAccount(handle: string, appPassword: string): Promise<unknown> {
    const url = `${this.baseUrl}/api/bluesky-connect`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ handle, appPassword }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to connect Bluesky account: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async listSchedules(): Promise<unknown> {
    const url = `${this.baseUrl}/api/schedule`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list schedules: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async listPosts(limit = 20): Promise<unknown> {
    const url = `${this.baseUrl}/api/schedule/status?limit=${encodeURIComponent(String(limit))}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to list posts: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async cancelSchedule(scheduleId: string): Promise<unknown> {
    const url = `${this.baseUrl}/api/schedule?id=${encodeURIComponent(scheduleId)}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to cancel schedule: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async getTokenBalance(): Promise<unknown> {
    const url = `${this.baseUrl}/api/billing/tokens`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get token balance: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async generateVideoJob(input: GenerateVideoJobInput): Promise<unknown> {
    const url = `${this.baseUrl}/api/persona/video-job`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        personaId: input.personaId,
        video_script_prompt: input.scriptPrompt,
        audio_url: input.audioUrl,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to generate video job: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async getVideoStatus(taskId: string): Promise<unknown> {
    const url = `${this.baseUrl}/api/persona/video-status/${encodeURIComponent(taskId)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to get video status: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async createSchedule(input: CreateScheduleInput): Promise<unknown> {
    if (input.scheduledAt) {
      const validation = validateScheduleAdvance(input.scheduledAt, input._nowForTesting);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }
    }

    const url = `${this.baseUrl}/api/schedule`;
    const response = await fetch(url, {
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
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create schedule: ${response.status} ${errorText}`);
    }

    return response.json();
  }
}
