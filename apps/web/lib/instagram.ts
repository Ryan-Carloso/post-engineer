import 'server-only';

import axios, { AxiosError } from 'axios';
import crypto from 'crypto';
import { logger } from '@/lib/logger';
import { InstagramApiError } from '@/lib/errors';
import { readMetaErrorCode, readMetaErrorSubcode } from '@/lib/meta-error-code';
import { parseInstagramInsightsPayload } from '@/lib/instagram-insights';
import { INSTAGRAM_USERNAME_FALLBACK } from '@/lib/providers/registry';

export interface InstagramLongLivedToken {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

const INSTAGRAM_PROFILE_TIMEOUT_MS = 8000;

const INSTAGRAM_PROFILE_FIELDS =
  'id,username,name,profile_picture_url,followers_count,media_count';

export interface InstagramProfile {
  userdId: string;
  username: string;
  name?: string;
  profilePictureUrl?: string;
  followersCount?: number;
  mediaCount?: number;
}

export interface InstagramPublishResult {
  mediaId: string;
  postId: string;
  permalink?: string;
}

export class InstagramService {
  private static apiVersion = 'v23.0';

  static getApiVersion(): string {
    return InstagramService.apiVersion;
  }

  private apiVersion: string;
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;

  constructor(redirectUriOverride?: string) {
    this.apiVersion = InstagramService.apiVersion;

    if (!process.env.INSTAGRAM_CLIENT_ID) {
      throw new Error('INSTAGRAM_CLIENT_ID environment variable is required');
    }
    if (!process.env.INSTAGRAM_CLIENT_SECRET) {
      throw new Error('INSTAGRAM_CLIENT_SECRET environment variable is required');
    }
    const redirectUri = redirectUriOverride ?? process.env.INSTAGRAM_REDIRECT_URI;
    if (!redirectUri) {
      throw new Error('INSTAGRAM_REDIRECT_URI environment variable is required');
    }

    this.clientId = process.env.INSTAGRAM_CLIENT_ID;
    this.clientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
    this.redirectUri = redirectUri;

  }

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments,instagram_business_content_publish,instagram_business_manage_insights',
      state,
    });

    return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
  }

  private handleApiError(error: unknown, context: string, { log }: { log: boolean } = { log: true }): never {
    const asError = error instanceof Error ? error : new Error(String(error));
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<Record<string, unknown>>;
      const responseData = axiosError.response?.data;

      let message = axiosError.message;
      if (responseData) {
        const em = responseData.error_message;
        const rm = responseData.message;
        const ed = responseData.error_description;
        const rawError = responseData.error;

        if (typeof em === 'string' && em) {
          message = em;
        } else if (typeof rm === 'string' && rm) {
          message = rm;
        } else if (typeof ed === 'string' && ed) {
          message = ed;
        } else if (typeof rawError === 'string' && rawError) {
          message = rawError;
        } else if (typeof rawError === 'object' && rawError !== null) {
          const errObj = rawError as Record<string, unknown>;
          message = typeof errObj.message === 'string' ? errObj.message : JSON.stringify(rawError);
        } else {
          message = JSON.stringify(responseData);
        }
      }

      if (log) {
        logger.error('[instagram] API ERROR', asError, {
          context,
          status: axiosError.response?.status,
          message,
          responseData,
        });
      }
      throw new InstagramApiError(message, axiosError.response?.status ?? 500, asError, readMetaErrorCode(responseData), readMetaErrorSubcode(responseData));
    }
    if (log) {
      logger.error('[instagram] NON-AXIOS ERROR', asError, { context, message: asError.message });
    }
    throw new InstagramApiError(asError.message, 500, asError);
  }

  private redactSecrets(text: string): string {
    if (!text || !this.clientSecret) return text;
    return text.split(this.clientSecret).join('[redacted]');
  }

  private describeTokenExchangeError(status: number, rawBody: string): string {
    let detail = this.redactSecrets(rawBody).slice(0, 500);
    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      const candidates = [
        parsed.error_message,
        parsed.message,
        parsed.error_description,
      ];
      const found = candidates.find(
        (v): v is string => typeof v === 'string' && v.length > 0
      );
      if (found) {
        detail = this.redactSecrets(found);
      } else if (typeof parsed.error === 'string' && parsed.error.length > 0) {
        detail = this.redactSecrets(parsed.error);
      } else if (typeof parsed.error === 'object' && parsed.error !== null) {
        const nested = (parsed.error as Record<string, unknown>).message;
        detail =
          typeof nested === 'string' && nested.length > 0
            ? this.redactSecrets(nested)
            : detail;
      }
    } catch {
    }
    return `Instagram token exchange failed (status ${status}): ${detail || 'no details'}`;
  }

  private async exchangeCodeForShortLivedToken(
    code: string
  ): Promise<{ accessToken: string; userId: string }> {
    const tokenEndpoint = 'https://api.instagram.com/oauth/access_token';

    let response: Response;
    try {
      response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'authorization_code',
          redirect_uri: this.redirectUri,
          code,
        }),
      });
    } catch (networkError) {
      const rawMessage =
        networkError instanceof Error ? networkError.message : String(networkError);
      logger.error(
        '[instagram] token exchange network error',
        networkError instanceof Error ? networkError : new Error(rawMessage),
        { message: this.redactSecrets(rawMessage) }
      );
      throw new InstagramApiError(
        `Instagram token exchange request failed: ${this.redactSecrets(rawMessage)}`,
        500,
        networkError instanceof Error ? networkError : undefined
      );
    }

    if (!response.ok) {
      const rawBody = await response.text().catch(() => '');
      const message = this.describeTokenExchangeError(response.status, rawBody);
      logger.error('[instagram] token exchange failed', new Error(message), {
        status: response.status,
        body: this.redactSecrets(rawBody).slice(0, 500),
      });
      throw new InstagramApiError(message, response.status);
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new InstagramApiError(
        `Instagram token exchange returned an invalid response (status ${response.status}).`,
        response.status
      );
    }
    const parsed = data as { access_token?: unknown; user_id?: unknown };
    if (typeof parsed.access_token !== 'string' || !parsed.access_token) {
      throw new InstagramApiError(
        `Instagram token exchange did not return an access_token (status ${response.status}).`,
        response.status
      );
    }
    return {
      accessToken: parsed.access_token,
      userId: String(parsed.user_id ?? ''),
    };
  }

  async exchangeCodeForLongLivedToken(code: string): Promise<InstagramLongLivedToken> {
    const longLivedEndpoint = 'https://graph.instagram.com/access_token';

    const shortLived = await this.exchangeCodeForShortLivedToken(code);

    try {
      const longTokenResponse = await axios.get(longLivedEndpoint, {
        params: {
          grant_type: 'ig_exchange_token',
          client_secret: this.clientSecret,
          access_token: shortLived.accessToken,
        },
      });

      const longLived = longTokenResponse.data as {
        access_token: string;
        token_type: string;
        expires_in: number;
      };

      return {
        accessToken: longLived.access_token,
        tokenType: longLived.token_type || 'bearer',
        expiresIn: longLived.expires_in,
      };
    } catch (error) {
      this.handleApiError(error, 'exchangeCodeForLongLivedToken');
    }
  }
  async getMediaInsights(mediaId: string, accessToken: string): Promise<Record<string, number>> {
    try {
      const response = await axios.get(
        `https://graph.instagram.com/${this.apiVersion}/${encodeURIComponent(mediaId)}/insights`,
        {
          params: { metric: 'views,likes,comments,saved', access_token: accessToken },
          timeout: 15_000,
        },
      );
      return parseInstagramInsightsPayload(response.data);
    } catch (error) {
      this.handleApiError(error, 'getMediaInsights', { log: false });
    }
  }

  async getProfile(accessToken: string): Promise<InstagramProfile> {
    try {
      const response = await axios.get(
        `https://graph.instagram.com/${this.apiVersion}/me`,
        {
          params: {
            fields: INSTAGRAM_PROFILE_FIELDS,
            access_token: accessToken,
          },
          timeout: INSTAGRAM_PROFILE_TIMEOUT_MS,
        }
      );

      const data = response.data as {
        id: string;
        username?: string;
        name?: string;
        profile_picture_url?: string;
        followers_count?: number;
        media_count?: number;
      };

      const profile = {
        userdId: data.id,
        username: data.username || INSTAGRAM_USERNAME_FALLBACK,
        name: data.name,
        profilePictureUrl: data.profile_picture_url,
        followersCount: data.followers_count,
        mediaCount: data.media_count,
      };

      return profile;
    } catch (error) {
      this.handleApiError(error, 'getProfile');
    }
  }

  async publishMedia(
    igUserId: string,
    accessToken: string,
    caption: string,
    mediaUrl: string,
    isVideo: boolean,
    aiLabel = false
  ): Promise<InstagramPublishResult> {
    const mediaType = isVideo ? 'REELS' : 'IMAGE';

    try {
      const containerResponse = await axios.post(
        `https://graph.instagram.com/${this.apiVersion}/${igUserId}/media`,
        null,
        {
          params: {
            caption,
            access_token: accessToken,
            ...(isVideo
              ? { media_type: 'REELS', video_url: mediaUrl, ...(aiLabel ? { is_ai_generated: true } : {}) }
              : { image_url: mediaUrl }),
          },
        }
      );

      const { id: creationId } = containerResponse.data as { id: string };

      await this.waitForContainer(creationId, accessToken);

      const publishResponse = await axios.post(
        `https://graph.instagram.com/${this.apiVersion}/${igUserId}/media_publish`,
        null,
        {
          params: {
            creation_id: creationId,
            access_token: accessToken,
          },
        }
      );

      const published = publishResponse.data as { id: string };

      let permalink: string | undefined;
      try {
        const permalinkResponse = await axios.get(
          `https://graph.instagram.com/${this.apiVersion}/${published.id}`,
          {
            params: { fields: 'permalink', access_token: accessToken },
          }
        );
        permalink = (permalinkResponse.data as { permalink?: string }).permalink;
      } catch {
      }

      return {
        mediaId: creationId,
        postId: published.id,
        permalink,
      };
    } catch (error) {
      const axiosData = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { status?: number; data?: unknown } })
        : undefined;
      logger.error('[instagram] publishMedia failed', error, {
        igUserId,
        mediaType,
        mediaUrlHash: crypto.createHash('sha256').update(mediaUrl).digest('hex').slice(0, 12),
        status: axiosData?.response?.status,
        apiError: axiosData?.response?.data,
        message: error instanceof Error ? error.message : String(error),
      });
      this.handleApiError(error, 'publishMedia', { log: false });
    }
  }

  private async waitForContainer(creationId: string, accessToken: string): Promise<void> {
    const maxAttempts = 30;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await axios.get(
          `https://graph.instagram.com/${this.apiVersion}/${creationId}`,
          {
            params: { fields: 'status_code', access_token: accessToken },
          }
        );
        const status = (response.data as { status_code?: string }).status_code;
        if (status === 'FINISHED') return;
        if (status === 'ERROR') {
          throw new InstagramApiError(`Instagram media processing failed (creation ${creationId}, attempt ${attempt})`, 400);
        }
      } catch (error) {
        if (error instanceof InstagramApiError) throw error;
        logger.error('[instagram] waitForContainer polling failed', error, { creationId, attempt });
        this.handleApiError(error, 'waitForContainer', { log: false });
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new InstagramApiError('Timed out waiting for media processing', 408);
  }

  async refreshLongLivedToken(accessToken: string): Promise<InstagramLongLivedToken> {
    try {
      const response = await axios.get(
        'https://graph.instagram.com/refresh_access_token',
        {
          params: {
            grant_type: 'ig_refresh_token',
            access_token: accessToken,
          },
          timeout: 15_000,
        }
      );

      const data = response.data as { access_token?: unknown; token_type?: unknown; expires_in?: unknown };
      if (typeof data.access_token !== 'string' || data.access_token === '') {
        throw new InstagramApiError('Instagram token refresh returned no access token', 502);
      }
      if (typeof data.expires_in !== 'number' || !(data.expires_in > 0)) {
        throw new InstagramApiError('Instagram token refresh returned an invalid expires_in', 502);
      }
      const tokenType = typeof data.token_type === 'string' && data.token_type !== '' ? data.token_type : 'bearer';
      return { accessToken: data.access_token, tokenType, expiresIn: data.expires_in };
    } catch (error) {
      if (error instanceof InstagramApiError) throw error;
      this.handleApiError(error, 'refreshLongLivedToken');
    }
  }
}
