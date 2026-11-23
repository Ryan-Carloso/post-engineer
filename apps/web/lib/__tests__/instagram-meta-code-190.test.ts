import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPost = vi.fn();
const mockGet = vi.fn();

vi.mock('axios', () => ({
  default: {
    post: (...args: unknown[]) => mockPost(...args),
    get: (...args: unknown[]) => mockGet(...args),
    isAxiosError: vi.fn((err: unknown) => {
      return err && typeof err === 'object' && 'isAxiosError' in err;
    }),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    generateLogId: () => 'log-1',
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    logUploadProgress: vi.fn(),
  },
}));

import { InstagramService } from '@/lib/instagram';
import { InstagramApiError } from '@/lib/errors';
import { logger } from '@/lib/logger';

describe('InstagramService Meta code 190', () => {
  const envBackup = { ...process.env };

  const meta190Body = {
    error: {
      code: 190,
      message:
        'Error validating access token: The session has been invalidated because the user changed their password.',
      type: 'OAuthException',
    },
  };

  function meta190AxiosError(): unknown {
    return Object.assign(new Error('Request failed with status code 400'), {
      isAxiosError: true,
      response: { status: 400, data: meta190Body },
    });
  }

  beforeEach(() => {
    process.env.INSTAGRAM_CLIENT_ID = 'test-id';
    process.env.INSTAGRAM_CLIENT_SECRET = 'test-secret';
    process.env.INSTAGRAM_REDIRECT_URI = 'https://test.com/callback';
    mockPost.mockReset();
    mockGet.mockReset();
    vi.mocked(logger.error).mockClear();
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('keeps the Meta provider code when a dead token answers 400 + code 190', async () => {
    mockPost.mockRejectedValueOnce(meta190AxiosError());

    const service = new InstagramService();
    const error = await service
      .publishMedia('user', 'tok', 'cap', 'https://example.com/img.jpg', false)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InstagramApiError);
    expect((error as InstagramApiError).statusCode).toBe(400);
    expect((error as InstagramApiError).providerCode).toBe(190);
    expect((error as InstagramApiError).message).toContain('Error validating access token');
  });

  it('logs the publish failure once, with the original error as the cause', async () => {
    const axiosError = meta190AxiosError();
    mockPost.mockRejectedValueOnce(axiosError);

    const service = new InstagramService();
    await service
      .publishMedia('user', 'tok', 'cap', 'https://example.com/img.jpg', false)
      .catch(() => undefined);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[instagram] publishMedia failed',
      axiosError,
      expect.objectContaining({ status: 400 }),
    );
  });

  it('logs a Meta 190 profile failure once, with the original error as the cause', async () => {
    const axiosError = meta190AxiosError();
    mockGet.mockRejectedValueOnce(axiosError);

    const service = new InstagramService();
    const error = await service.getProfile('tok').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InstagramApiError);
    expect((error as InstagramApiError).providerCode).toBe(190);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[instagram] API ERROR',
      axiosError,
      expect.objectContaining({ status: 400 }),
    );
  });

  it('logs a non-axios publish failure once, with the original error as the cause', async () => {
    const plainError = new Error('socket hang up');
    mockPost.mockRejectedValueOnce(plainError);

    const service = new InstagramService();
    const error = await service
      .publishMedia('user', 'tok', 'cap', 'https://example.com/img.jpg', false)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InstagramApiError);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[instagram] publishMedia failed',
      plainError,
      expect.objectContaining({ status: undefined }),
    );
  });

  it('logs a non-axios profile failure once, with the original error as the cause', async () => {
    const plainError = new Error('socket hang up');
    mockGet.mockRejectedValueOnce(plainError);

    const service = new InstagramService();
    const error = await service.getProfile('tok').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InstagramApiError);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[instagram] NON-AXIOS ERROR',
      plainError,
      expect.objectContaining({ context: 'getProfile' }),
    );
  });

  it('reports a container ERROR status once, naming the creation in the thrown error', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'err-container' } });
    mockGet.mockResolvedValueOnce({ data: { status_code: 'ERROR' } });

    const service = new InstagramService();
    const error = await service
      .publishMedia('user', 'tok', 'cap', 'https://example.com/vid.mp4', true)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InstagramApiError);
    expect((error as InstagramApiError).message).toContain('err-container');
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[instagram] publishMedia failed',
      expect.any(InstagramApiError),
      expect.objectContaining({ igUserId: 'user' }),
    );
  });

  it('logs a polling failure with the original error as the cause, not its message string', async () => {
    const pollingError = new Error('polling boom');
    mockPost.mockResolvedValueOnce({ data: { id: 'c1' } });
    mockGet.mockRejectedValueOnce(pollingError);

    const service = new InstagramService();
    await expect(
      service.publishMedia('user', 'tok', 'cap', 'https://example.com/vid.mp4', true),
    ).rejects.toThrow(InstagramApiError);

    expect(logger.error).toHaveBeenCalledWith(
      '[instagram] waitForContainer polling failed',
      pollingError,
      expect.objectContaining({ creationId: 'c1' }),
    );
  });

  it('keeps the Meta provider code and subcode when getMediaInsights answers 400 + code 100 subcode 33 (deleted media)', async () => {
    const goneBody = {
      error: {
        message: 'Unsupported get request. Object with ID \'media-9\' does not exist',
        type: 'RestException',
        code: 100,
        error_subcode: 33,
        fbtrace_id: 'trace-gone',
      },
    };
    const axiosError = Object.assign(new Error('Request failed with status code 400'), {
      isAxiosError: true,
      response: { status: 400, data: goneBody },
    });
    mockGet.mockRejectedValueOnce(axiosError);

    const service = new InstagramService();
    const error = await service.getMediaInsights('media-9', 'tok').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InstagramApiError);
    expect((error as InstagramApiError).statusCode).toBe(400);
    expect((error as InstagramApiError).providerCode).toBe(100);
    expect((error as InstagramApiError).providerSubcode).toBe(33);
    expect((error as InstagramApiError).message).toContain('Unsupported get request');
  });

  it('keeps the Meta provider code when getMediaInsights answers 400 + code 190 (dead token)', async () => {
    mockGet.mockRejectedValueOnce(meta190AxiosError());

    const service = new InstagramService();
    const error = await service.getMediaInsights('media-9', 'tok').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InstagramApiError);
    expect((error as InstagramApiError).statusCode).toBe(400);
    expect((error as InstagramApiError).providerCode).toBe(190);
    expect((error as InstagramApiError).message).toContain('Error validating access token');
  });
});
