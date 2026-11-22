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

describe('InstagramService single $exception per publish failure', () => {
  const envBackup = { ...process.env };

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
    vi.useRealTimers();
  });

  it('container ERROR: logs exactly once and the thrown error names the creation', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'err-container' } });
    mockGet.mockResolvedValueOnce({ data: { status_code: 'ERROR' } });

    const service = new InstagramService();
    const error = await service
      .publishMedia('user', 'tok', 'cap', 'https://example.com/vid.mp4', true)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InstagramApiError);
    expect((error as InstagramApiError).message).toContain('err-container');
    const calls = vi.mocked(logger.error).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('[instagram] publishMedia failed');
    expect((calls[0][1] as Error).message).toContain('err-container');
    expect(calls[0][2]).toEqual(expect.objectContaining({ igUserId: 'user' }));
  });

  it('container creation failure: logs exactly once', async () => {
    const axiosError = Object.assign(new Error('Request failed with status code 400'), {
      isAxiosError: true,
      response: { status: 400, data: { error_message: 'Bad request' } },
    });
    mockPost.mockRejectedValueOnce(axiosError);

    const service = new InstagramService();
    const error = await service
      .publishMedia('user', 'tok', 'cap', 'https://example.com/img.jpg', false)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InstagramApiError);
    expect((error as InstagramApiError).message).toBe('Bad request');
    expect(vi.mocked(logger.error).mock.calls).toHaveLength(1);
  });

  it('polling failure: logs twice, once per layer that saw it', async () => {
    const pollingError = new Error('polling boom');
    mockPost.mockResolvedValueOnce({ data: { id: 'c1' } });
    mockGet.mockRejectedValueOnce(pollingError);

    const service = new InstagramService();
    await expect(
      service.publishMedia('user', 'tok', 'cap', 'https://example.com/vid.mp4', true),
    ).rejects.toThrow(InstagramApiError);

    const calls = vi.mocked(logger.error).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe('[instagram] waitForContainer polling failed');
    expect(calls[0][1]).toBe(pollingError);
    expect(calls[1][0]).toBe('[instagram] publishMedia failed');
    expect(calls[1][1]).toBeInstanceOf(InstagramApiError);
  });

  it('container timeout: logs exactly once', async () => {
    vi.useFakeTimers();
    mockPost.mockResolvedValueOnce({ data: { id: 'c1' } });
    mockGet.mockResolvedValue({ data: { status_code: 'PROCESSING' } });

    const service = new InstagramService();
    const pending = service
      .publishMedia('user', 'tok', 'cap', 'https://example.com/img.jpg', false)
      .catch((caught: unknown) => caught);

    await vi.advanceTimersByTimeAsync(30 * 30 * 2000 + 1000);
    const error = await pending;

    expect(error).toBeInstanceOf(InstagramApiError);
    expect((error as InstagramApiError).message).toContain('Timed out');
    expect(vi.mocked(logger.error).mock.calls).toHaveLength(1);
  });
});
