import 'server-only';

import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { Readable } from 'stream';
import { logger } from '@/lib/logger';

export interface YouTubeVideoMetadata {
  snippet: {
    title: string;
    description?: string;
    tags?: string[];
    categoryId?: string;
  };
  status: {
    privacyStatus: 'public' | 'private' | 'unlisted';
    selfDeclaredMadeForKids?: boolean;
  };
}

export interface YouTubeUploadOptions {
  title: string;
  description?: string;
  tags?: string[];
  privacyStatus?: 'public' | 'private' | 'unlisted';
  categoryId?: string;
}

export function getYouTubeClient(authClient: OAuth2Client) {
  return google.youtube({
    version: 'v3',
    auth: authClient
  } as never);
}

export async function createGoogleOAuth2Client(redirectUriOverride?: string): Promise<OAuth2Client> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = redirectUriOverride ?? process.env.GOOGLE_REDIRECT_URI;

  const logId = logger.generateLogId();

  // Diagnostic log - Credentials and redirect_uri
  logger.info('🔍 OAuth2Client creation - diagnostics', {
    logId,
    component: 'createGoogleOAuth2Client',
    clientId: clientId ? `${clientId.substring(0, 20)}...` : '❌ NOT SET',
    clientSecret: clientSecret ? '✅ SET' : '❌ NOT SET',
    redirectUri: redirectUri,
    timestamp: new Date().toISOString()
  });

  if (!clientId || !clientSecret) {
    logger.error('❌ Critical failure - OAuth credentials not configured', new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment variables'), {
      logId,
      component: 'createGoogleOAuth2Client',
      missingCredentials: {
        clientId: !clientId,
        clientSecret: !clientSecret
      }
    });
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment variables');
  }

  if (!redirectUri) {
    logger.error('❌ Critical failure - GOOGLE_REDIRECT_URI not configured', new Error('GOOGLE_REDIRECT_URI must be set in environment variables'), {
      logId,
      component: 'createGoogleOAuth2Client',
      missingRedirectUri: true
    });
    throw new Error('GOOGLE_REDIRECT_URI must be set in environment variables');
  }

  const { OAuth2Client } = await import('google-auth-library');
  const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

  // Success log - OAuth2Client created
  logger.info('✅ OAuth2Client created successfully', {
    logId,
    component: 'createGoogleOAuth2Client',
    redirectUri,
    clientIdPrefix: `${clientId.substring(0, 15)}...`,
    timestamp: new Date().toISOString()
  });

  return oauth2Client;
}

export function generateGoogleAuthUrl(oauth2Client: OAuth2Client, state?: string): string {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'openid',
      'profile',
      'email',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly'
    ],
    prompt: 'consent', // Force consent to get refresh token
    ...(state ? { state } : {}),
  });

  const logId = logger.generateLogId();

  // Diagnostic log - generated auth URL
  logger.info('🔗 Generated authorization URL - diagnostics', {
    logId,
    component: 'generateGoogleAuthUrl',
    authUrlGenerated: true,
    authUrlPreview: authUrl.substring(0, 100) + '...',
    scopes: [
      'openid',
      'profile',
      'email',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly'
    ],
    accessType: 'offline',
    prompt: 'consent',
    timestamp: new Date().toISOString()
  });

  return authUrl;
}

export function createVideoMetadata(options: YouTubeUploadOptions): YouTubeVideoMetadata {
  return {
    snippet: {
      title: options.title,
      description: options.description || '',
      tags: options.tags || [],
      categoryId: options.categoryId || '22' // People & Blogs
    },
    status: {
      privacyStatus: options.privacyStatus || 'public',
      selfDeclaredMadeForKids: false
    }
  };
}

export async function uploadYouTubeVideo(
  authClient: OAuth2Client,
  videoFile: File | Buffer,
  metadata: YouTubeVideoMetadata,
): Promise<{ id: string; url: string }> {
  const youtube = getYouTubeClient(authClient);
  
  // Get file size and create stream
  let videoStream: Readable;

  if (videoFile instanceof File) {
    videoStream = Readable.fromWeb(videoFile.stream() as never);
  } else {
    // Buffer is not accepted by googleapis (it expects a stream with .pipe)
    videoStream = Readable.from(videoFile);
  }

  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: metadata,
    media: {
      body: videoStream,
      mimeType: 'video/mp4'
    }
  });

  if (!response.data.id) {
    throw new Error('Failed to upload video - no video ID returned');
  }

  return {
    id: response.data.id,
    url: `https://www.youtube.com/watch?v=${response.data.id}`
  };
}

export async function getYouTubeVideoInfo(
  authClient: OAuth2Client,
  videoId: string
): Promise<unknown> {
  const youtube = getYouTubeClient(authClient);

  const response = await youtube.videos.list({
    part: ['snippet', 'status', 'statistics'],
    id: [videoId]
  });

  if (!response.data.items || response.data.items.length === 0) {
    throw new Error('Video not found');
  }

  return response.data.items[0];
}
