// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';
import { isPublicHttpsWebhookUrl } from '../webhook-url';

interface WebhookUrlCases {
  accepted: string[];
  rejected: string[];
}

function loadCases(): WebhookUrlCases {
  const root = findRepoRoot(import.meta.url);
  const raw: unknown = JSON.parse(readFileSync(join(root, 'shared', 'ssrf', 'webhook-url-cases.json'), 'utf8'));
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('accepted' in raw) ||
    !('rejected' in raw) ||
    !Array.isArray(raw.accepted) ||
    !Array.isArray(raw.rejected) ||
    !raw.accepted.every((url) => typeof url === 'string') ||
    !raw.rejected.every((url) => typeof url === 'string')
  ) {
    throw new Error('shared/ssrf/webhook-url-cases.json has an unexpected shape');
  }
  return raw as WebhookUrlCases;
}

const cases = loadCases();

describe('isPublicHttpsWebhookUrl — shared webhook fixture', () => {
  it.each(cases.accepted)('accepts %s', (url) => {
    expect(isPublicHttpsWebhookUrl(url)).toBe(true);
  });

  it.each(cases.rejected)('rejects %s', (url) => {
    expect(isPublicHttpsWebhookUrl(url)).toBe(false);
  });

  // Multicast literals are not in the shared table: Python still reports
  // them global (blockedBeyondPython), so the engine accepts them. The web
  // rule is stricter and blocks them.
  it('rejects a multicast literal (stricter than the engine)', () => {
    expect(isPublicHttpsWebhookUrl('https://224.0.0.1/hook')).toBe(false);
    expect(isPublicHttpsWebhookUrl('https://[ff02::1]/hook')).toBe(false);
  });

  it('rejects a value that is not a URL', () => {
    expect(isPublicHttpsWebhookUrl('not a url')).toBe(false);
    expect(isPublicHttpsWebhookUrl('')).toBe(false);
  });
});
