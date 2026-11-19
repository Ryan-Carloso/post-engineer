import { TimeoutError } from './errors';

export interface TimeoutOptions {
  timeoutMs: number;
  onProgress?: (elapsedMs: number, remainingMs: number) => void;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  options: TimeoutOptions
): Promise<T> {
  const { timeoutMs, onProgress } = options;
  const startTime = Date.now();

  let progressInterval: NodeJS.Timeout | undefined;
  if (onProgress) {
    progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = timeoutMs - elapsed;
      onProgress(elapsed, remaining);
    }, 1000);
  }

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      if (progressInterval) clearInterval(progressInterval);
      reject(new TimeoutError(
        `Operation timed out after ${timeoutMs}ms`,
        timeoutMs
      ));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    if (progressInterval) clearInterval(progressInterval);
    return result;
  } catch (error) {
    if (progressInterval) clearInterval(progressInterval);
    throw error;
  }
}

export const TIMEOUT_CONFIG = {
  UPLOAD_TIMEOUT: 30 * 60 * 1000,
  OAUTH_TIMEOUT: 5 * 60 * 1000,
  HEALTH_CHECK_TIMEOUT: 10 * 1000,
  CONNECTION_TIMEOUT: 30 * 1000,
  VALIDATION_TIMEOUT: 5 * 1000,
} as const;

export async function withUploadTimeout<T>(promise: Promise<T>): Promise<T> {
  return withTimeout(promise, {
    timeoutMs: TIMEOUT_CONFIG.UPLOAD_TIMEOUT
  });
}

export async function withOAuthTimeout<T>(promise: Promise<T>): Promise<T> {
  return withTimeout(promise, {
    timeoutMs: TIMEOUT_CONFIG.OAUTH_TIMEOUT
  });
}

export async function withHealthCheckTimeout<T>(promise: Promise<T>): Promise<T> {
  return withTimeout(promise, {
    timeoutMs: TIMEOUT_CONFIG.HEALTH_CHECK_TIMEOUT
  });
}