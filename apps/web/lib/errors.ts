export class TimeoutError extends Error {
  constructor(message: string, public timeoutMs: number) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class AuthError extends Error {
  constructor(message: string, public authType?: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class UploadError extends Error {
  constructor(
    message: string,
    public uploadStage: 'validation' | 'upload' | 'processing' | 'finalization'
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public youtubeError?: Error
  ) {
    super(message);
    this.name = 'YouTubeApiError';
  }
}

export class InstagramApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public instagramError?: Error
  ) {
    super(message);
    this.name = 'InstagramApiError';
  }
}

export class LinkedInError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public linkedinError?: Error
  ) {
    super(message);
    this.name = 'LinkedInError';
  }
}

export class NetworkError extends Error {
  constructor(message: string, public networkDetails?: Record<string, unknown>) {
    super(message);
    this.name = 'NetworkError';
  }
}

//---------------
// Enhanced error types for debugging and logging
//---------------

interface DebuggableError extends Error {
  cause?: unknown;
  logId?: string;
}

export class DebuggableBaseError extends Error implements DebuggableError {
  cause?: unknown;
  logId?: string;

  constructor(message: string, options?: { cause?: unknown; logId?: string }) {
    super(message);
    this.name = 'DebuggableBaseError';
    this.cause = options?.cause;
    this.logId = options?.logId;
  }
}

export class DebuggableAuthError extends AuthError implements DebuggableError {
  cause?: unknown;
  logId?: string;

  constructor(message: string, authType?: string, options?: { cause?: unknown; logId?: string }) {
    super(message, authType);
    this.name = 'DebuggableAuthError';
    this.cause = options?.cause;
    this.logId = options?.logId;
  }
}

export class DebuggableNetworkError extends NetworkError implements DebuggableError {
  cause?: unknown;
  logId?: string;

  constructor(message: string, networkDetails?: Record<string, unknown>, options?: { cause?: unknown; logId?: string }) {
    super(message, networkDetails);
    this.name = 'DebuggableNetworkError';
    this.cause = options?.cause;
    this.logId = options?.logId;
  }
}

export function getStatusCode(error: Error): number {
  if (error instanceof ValidationError) return 400;
  if (error instanceof TimeoutError) return 408;
  if (error instanceof AuthError) return 401;
  if (error instanceof YouTubeApiError) return error.statusCode;
  if (error instanceof InstagramApiError) return error.statusCode;
  if (error instanceof NetworkError) return 503;
  if (error instanceof UploadError) return 500;
  return 500;
}

export function getErrorType(error: Error): string {
  return error.name.toUpperCase();
}

export function getErrorSuggestions(error: Error): string[] {
  const suggestions: string[] = [];

  if (error instanceof ValidationError) {
    suggestions.push('Check the submitted data');
    if (error.field) suggestions.push(`Field "${error.field}" is invalid`);
  }

  if (error instanceof TimeoutError) {
    suggestions.push('Try again on a faster connection');
    suggestions.push('The file may be too large for the current timeout');
    suggestions.push('Contact support if the problem persists');
  }

  if (error instanceof AuthError) {
    suggestions.push('Check the OAuth credentials');
    suggestions.push('Start the OAuth flow again');
    suggestions.push('Check the app permissions in the Google Cloud Console');
  }

  if (error instanceof UploadError) {
    switch (error.uploadStage) {
      case 'validation':
        suggestions.push('Check the file format');
        suggestions.push('The file may be corrupted');
        break;
      case 'upload':
        suggestions.push('Try again on a more stable connection');
        suggestions.push('Check that the YouTube API is working');
        break;
      case 'processing':
        suggestions.push('YouTube may be processing another upload');
        suggestions.push('Wait a few minutes and try again');
        break;
      case 'finalization':
        suggestions.push('The upload completed, but finalization failed');
        suggestions.push('Check whether the video was published on YouTube');
        break;
    }
  }

  if (error instanceof YouTubeApiError) {
    suggestions.push('Check the YouTube API credentials');
    suggestions.push('See the error details for more information');
    if (error.statusCode === 401) {
      suggestions.push('Access token expired. Start OAuth again');
    }
    if (error.statusCode === 403) {
      suggestions.push('Insufficient permissions for this operation');
    }
  }

  if (error instanceof InstagramApiError) {
    suggestions.push('Check the Instagram API credentials');
    suggestions.push('See the error details for more information');
    if (error.statusCode === 401) {
      suggestions.push('Access token expired. Start OAuth again');
    }
    if (error.statusCode === 403) {
      suggestions.push('Insufficient permissions for this operation');
    }
  }

  if (error instanceof NetworkError) {
    suggestions.push('Check your internet connection');
    suggestions.push('The YouTube service may be temporarily unavailable');
    suggestions.push('Try again in a few minutes');
  }

  if (suggestions.length === 0) {
    suggestions.push('An unknown error occurred');
    suggestions.push('Try again or contact support');
  }

  return suggestions;
}