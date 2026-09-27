//---------------
// Console-only logger — no filesystem, no winston dependencies
//---------------

interface LogEntry {
  timestamp: string;
  type: 'ERROR' | 'INFO' | 'WARN' | 'DEBUG';
  logId: string;
  endpoint: string;
  method: string;
  message: string;
  error?: Error;
  metadata?: Record<string, unknown>;
  userId?: string;
  ip?: string;
  duration?: number;
}

//---------------
// Helper function for consistent console output
//---------------

function consoleLog(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string, metadata?: Record<string, unknown>, error?: Error): string {
  const timestamp = new Date().toISOString();
  const logId = `${timestamp.slice(0, 10)}_${timestamp.slice(11, 19).replace(/:/g, '')}_${Math.random().toString(36).substring(2, 8)}`;
  const logEntry: LogEntry = {
    timestamp,
    type: level,
    logId,
    endpoint: metadata?.endpoint as string || 'unknown',
    method: metadata?.method as string || 'GET',
    message,
    error,
    metadata,
  };

  const prefix = `[${level}] [${logEntry.logId}]`;
  const metaString = metadata ? ` ${JSON.stringify(metadata)}` : '';
  const errorString = error ? ` ${error.message}${error.stack ? `\n${error.stack}` : ''}` : '';

   
  console.log(prefix, message + metaString + errorString);

  return logId;
}

//---------------
// Logger class with identical public API
//---------------

class Logger {
  //---------------
  // Public API: generateLogId
  //---------------

  public generateLogId(): string {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toTimeString().split(' ')[0].replace(/:/g, '');
    const random = Math.random().toString(36).substring(2, 8);
    return `${date}_${time}_${random}`;
  }

  //---------------
  // Public API: core logging methods (return logId for chaining)
  //---------------

  info(message: string, metadata?: Record<string, unknown>): string {
    return consoleLog('INFO', message, metadata);
  }

  error(message: string, error: Error, metadata?: Record<string, unknown>): string {
    return consoleLog('ERROR', message, metadata, error);
  }

  warn(message: string, metadata?: Record<string, unknown>): string {
    return consoleLog('WARN', message, metadata);
  }

  debug(message: string, metadata?: Record<string, unknown>): string {
    return consoleLog('DEBUG', message, metadata);
  }

  //---------------
  // Public API: specialized logging methods (void return, drop-in compatible)
  //---------------

  logUploadStart(logId: string, metadata: Record<string, unknown>): void {
     
    console.log('[INFO] [UPLOAD_START]', messageWithLogId(logId, 'Upload started'), metadata);
  }

  logUploadProgress(logId: string, progress: { uploadedBytes: number; totalBytes: number; percentage: number }): void {
     
    console.log('[DEBUG] [UPLOAD_PROGRESS]', messageWithLogId(logId, `Upload progress: ${progress.percentage}%`), progress);
  }

  logUploadSuccess(logId: string, result: { videoId: string; videoUrl: string; duration: number }): void {
     
    console.log('[INFO] [UPLOAD_SUCCESS]', messageWithLogId(logId, 'Upload completed successfully'), result);
  }

  logUploadError(logId: string, error: Error, metadata: Record<string, unknown>): void {
     
    console.error('[ERROR] [UPLOAD_ERROR]', messageWithLogId(logId, 'Upload error'), metadata, error);
  }

  logOAuthStart(logId: string): void {
     
    console.log('[INFO] [OAUTH_START]', messageWithLogId(logId, 'OAuth flow started'));
  }

  logOAuthCallback(logId: string, code?: string): void {
     
    console.log('[INFO] [OAUTH_CALLBACK]', messageWithLogId(logId, 'OAuth callback received'), { hasCode: !!code });
  }

  logOAuthSuccess(logId: string, tokens: { access_token?: string; refresh_token?: string }): void {
     
    console.log('[INFO] [OAUTH_SUCCESS]', messageWithLogId(logId, 'OAuth completed successfully'), {
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
    });
  }

  logOAuthError(logId: string, error: Error): void {
     
    console.error('[ERROR] [OAUTH_ERROR]', messageWithLogId(logId, 'OAuth flow error'), error);
  }

  logInstagramAuthStart(logId: string): void {
     
    console.log('[INFO] [INSTAGRAM_OAUTH_START]', messageWithLogId(logId, 'Instagram OAuth flow started'));
  }

  logInstagramAuthCallback(logId: string, code?: string): void {
     
    console.log('[INFO] [INSTAGRAM_OAUTH_CALLBACK]', messageWithLogId(logId, 'Instagram OAuth callback received'), { hasCode: !!code });
  }

  logInstagramAuthSuccess(logId: string): void {
     
    console.log('[INFO] [INSTAGRAM_OAUTH_SUCCESS]', messageWithLogId(logId, 'Instagram OAuth completed successfully'));
  }

  logInstagramAuthError(logId: string, error: Error): void {
     
    console.error('[ERROR] [INSTAGRAM_OAUTH_ERROR]', messageWithLogId(logId, 'Instagram OAuth flow error'), error);
  }

  logInstagramPostStart(logId: string, igUserId: string): void {
     
    console.log('[INFO] [INSTAGRAM_POST_START]', messageWithLogId(logId, 'Starting Instagram post'), { igUserId });
  }

  logInstagramPostSuccess(logId: string, postId: string): void {
     
    console.log('[INFO] [INSTAGRAM_POST_SUCCESS]', messageWithLogId(logId, 'Instagram post created successfully'), { postId });
  }

  logInstagramPostError(logId: string, error: Error): void {
     
    console.error('[ERROR] [INSTAGRAM_POST_ERROR]', messageWithLogId(logId, 'Error creating Instagram post'), error);
  }
}

//---------------
// Helper for consistent message format in specialized methods
//---------------

function messageWithLogId(logId: string, message: string): string {
  return `[${logId}] ${message}`;
}

//---------------
// Singleton instance
//---------------

export const logger = new Logger();