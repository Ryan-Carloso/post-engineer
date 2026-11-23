import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GeneratePersonaVideoSchema } from '../single-video-shape.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

interface WebhookUrlCases {
  accepted: string[];
  rejected: string[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function loadCases(): WebhookUrlCases {
  const raw: unknown = JSON.parse(readFileSync(join(root, 'shared', 'ssrf', 'webhook-url-cases.json'), 'utf8'));
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('accepted' in raw) ||
    !('rejected' in raw) ||
    !isStringArray(raw.accepted) ||
    !isStringArray(raw.rejected)
  ) {
    throw new Error('shared/ssrf/webhook-url-cases.json has an unexpected shape');
  }
  return { accepted: raw.accepted, rejected: raw.rejected };
}

const cases = loadCases();

const VIDEO = {
  title: 'Porto trip',
  description: 'Agent description.',
  providers: ['youtube'],
  mode: 'asap' as const,
  segments: [{ kind: 'hook' as const, text: 'Stop scrolling, this Porto kitchen changes everything.' }],
};

function parseOptions(options: Record<string, unknown>) {
  return GeneratePersonaVideoSchema.safeParse({
    ...VIDEO,
    options: { videoType: 'voiceover', ...options },
  });
}

describe('webhookUrl matches the shared webhook fixture', () => {
  it.each(cases.accepted)('accepts %s', (webhookUrl) => {
    const parsed = parseOptions({ webhookUrl });
    expect(parsed.success, webhookUrl).toBe(true);
  });

  it.each(cases.rejected)('rejects %s', (webhookUrl) => {
    const parsed = parseOptions({ webhookUrl });
    expect(parsed.success, webhookUrl).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toContain('webhookUrl');
    }
  });

  it('rejects a multicast literal (stricter than the engine)', () => {
    for (const webhookUrl of ['https://224.0.0.1/hook', 'https://[ff02::1]/hook']) {
      const parsed = parseOptions({ webhookUrl });
      expect(parsed.success, webhookUrl).toBe(false);
    }
  });
});
