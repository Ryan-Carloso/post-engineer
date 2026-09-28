import 'server-only';

import axios, { AxiosError } from 'axios';
import crypto from 'crypto';
import { logger } from '@/lib/logger';
import { InstagramApiError } from '@/lib/errors';

//---------------
// InstagramService — Instagram API with Instagram Login (direct, no Facebook).
// Authorization: instagram.com/oauth/authorize
// Token exchange: api.instagram.com/oauth/access_token (short-lived) →
// graph.instagram.com (long-lived). Publishing: container + media_publish.
//---------------

export interface InstagramLongLivedToken {
  accessToken: string;
  tokenType: string;
  expiresIn: number; // segundos
}

export interface InstagramProfile {
  userdId: string; // app-scoped user id (IG)
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

  //---------------
  // getAuthorizationUrl — authorization URL (direct Instagram Login)
  //---------------
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

  //---------------
  // handleApiError — converts AxiosError into InstagramApiError
  //---------------
  private handleApiError(error: unknown, context: string): never {
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

      logger.error('[instagram] API ERROR', undefined, {
        context,
        status: axiosError.response?.status,
        message,
        responseData,
      });
      logger.error(`Instagram API error (${context})`, asError, {
        status: axiosError.response?.status,
        data: responseData,
      });
      throw new InstagramApiError(message, axiosError.response?.status ?? 500, asError);
    }
    logger.error('[instagram] NON-AXIOS ERROR', undefined, { context, message: asError.message });
    logger.error(`Instagram API error (${context})`, asError);
    throw new InstagramApiError(asError.message, 500, asError);
  }

  //---------------
  // redactSecrets — removes the client_secret from any text that goes to
  // logs or error messages (Instagram may echo parameters back in the body).
  //---------------
  private redactSecrets(text: string): string {
    if (!text || !this.clientSecret) return text;
    return text.split(this.clientSecret).join('[redacted]');
  }

  //---------------
  // describeTokenExchangeError — builds the token exchange error message
  // with the HTTP status and the body returned by Instagram, without exposing secrets.
  //---------------
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
      // keep the raw body (already redacted)
    }
    return `Instagram token exchange failed (status ${status}): ${detail || 'no details'}`;
  }

  //---------------
  // exchangeCodeForShortLivedToken — code → short-lived token.
  // Instagram REQUIRES POST with application/x-www-form-urlencoded on this
  // endpoint; GET returns "Unsupported request - method type: get".
  //---------------
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

  //---------------
  // exchangeCodeForLongLivedToken — code → token curto → token longo
  //---------------
  async exchangeCodeForLongLivedToken(code: string): Promise<InstagramLongLivedToken> {
    const longLivedEndpoint = 'https://graph.instagram.com/access_token';

    // Step 1: code → short-lived token (POST form-urlencoded, fetch nativo)
    const shortLived = await this.exchangeCodeForShortLivedToken(code);

    try {
      // Step 2: short-lived → long-lived (~60 days) — endpoint only accepts GET
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
  //---------------
  // getProfile — data of the authenticated IG user
  //---------------
  async getProfile(accessToken: string): Promise<InstagramProfile> {
    try {
      const response = await axios.get(
        `https://graph.instagram.com/${this.apiVersion}/me`,
        {
          params: {
            access_token: accessToken,
          },
        }
      );

      const data = response.data as {
        id: string;
        user_id?: string;
        username?: string;
        name?: string;
        profile_picture_url?: string;
        followers_count?: number;
        media_count?: number;
      };

      const profile = {
        userdId: data.user_id || data.id,
        username: data.username || 'instagram_user',
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

  //---------------
  // publishMedia — creates the media container and publishes (photo or video)
  //---------------
  async publishMedia(
    igUserId: string,
    accessToken: string,
    caption: string,
    mediaUrl: string,
    isVideo: boolean
  ): Promise<InstagramPublishResult> {
    const mediaType = isVideo ? 'REELS' : 'IMAGE';

    try {
      // Step 1: container
      const containerResponse = await axios.post(
        `https://graph.instagram.com/${this.apiVersion}/${igUserId}/media`,
        null,
        {
          params: {
            caption,
            access_token: accessToken,
            ...(isVideo
              ? { media_type: 'REELS', video_url: mediaUrl }
              : { image_url: mediaUrl }),
          },
        }
      );

      const { id: creationId } = containerResponse.data as { id: string };

      // Step 2: wait for processing — required for both video and image
      // (publishing before the container is FINISHED returns code 9007 "Media ID is not available")
      await this.waitForContainer(creationId, accessToken);

      // Step 3: publish
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

      // Permalink is optional (best-effort)
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
        // permalink is optional — ignore failures
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
      logger.error('[instagram] publishMedia failed', undefined, {
        igUserId,
        mediaType,
        mediaUrlHash: crypto.createHash('sha256').update(mediaUrl).digest('hex').slice(0, 12),
        status: axiosData?.response?.status,
        apiError: axiosData?.response?.data,
        message: error instanceof Error ? error.message : String(error),
      });
      this.handleApiError(error, 'publishMedia');
    }
  }

  //---------------
  // waitForContainer — polls the container status until it is ready
  //---------------
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
          logger.error('[instagram] waitForContainer IG error', undefined, { creationId, attempt, status, data: response.data });
          throw new InstagramApiError('Instagram media processing failed', 400);
        }
      } catch (error) {
        if (error instanceof InstagramApiError) throw error;
        logger.error('[instagram] waitForContainer polling failed', error instanceof Error ? error.message : String(error), { creationId, attempt });
        this.handleApiError(error, 'waitForContainer');
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new InstagramApiError('Timed out waiting for media processing', 408);
  }

  //---------------
  // refreshLongLivedToken — renews the long-lived token (~60 days, with a 24h margin)
  //---------------
  async refreshLongLivedToken(accessToken: string): Promise<InstagramLongLivedToken> {
    try {
      const response = await axios.get(
        'https://graph.instagram.com/refresh_access_token',
        {
          params: {
            grant_type: 'ig_refresh_token',
            access_token: accessToken,
          },
        }
      );

      const data = response.data as {
        access_token: string;
        token_type?: string;
        expires_in: number;
      };

      return {
        accessToken: data.access_token,
        tokenType: data.token_type || 'bearer',
        expiresIn: data.expires_in,
      };
    } catch (error) {
      this.handleApiError(error, 'refreshLongLivedToken');
    }
  }
}
