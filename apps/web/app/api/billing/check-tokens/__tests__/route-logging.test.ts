import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { POST } from '@/app/api/billing/check-tokens/route';
import { logger } from '@/lib/logger';

const ENV_KEY = 'MONEYPRINT_API_SECRET';
const previous = process.env[ENV_KEY];

afterEach(() => {
  if (previous === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = previous;
});

describe('POST /api/billing/check-tokens failure logging', () => {
  it('logs when the engine secret is not configured', async () => {
    delete process.env[ENV_KEY];
    const response = await POST(
      new Request('http://localhost:3434/api/billing/check-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('engine secret'),
      expect.objectContaining({ message: expect.stringContaining('MONEYPRINT_API_SECRET') }),
    );
  });
});
