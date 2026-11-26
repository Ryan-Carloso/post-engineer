// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DIRECT_CONNECT_PROVIDERS, SOCIAL_PROVIDERS } from '@/lib/contracts/providers';
import { integrationsGuide } from '../content/integrations';

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function readCount(text: string, pattern: RegExp): number {
  const match = text.match(pattern);
  if (match === null) throw new Error(`pattern ${pattern} not found in: ${text}`);
  const token = match[1].toLowerCase();
  if (/^\d+$/.test(token)) return Number.parseInt(token, 10);
  const value = NUMBER_WORDS[token];
  expect(value).not.toBeUndefined();
  return value;
}

function paragraphTexts(): string[] {
  return integrationsGuide.blocks
    .filter((block) => block.kind === 'paragraph')
    .map((block) => block.text.en);
}

describe('docs/integrations — prose provider counts match the providers contract', () => {
  it('states the total network count from SOCIAL_PROVIDERS', () => {
    const intro = paragraphTexts().find((text) => text.includes('publishes to'));
    if (intro === undefined) throw new Error('integrations intro paragraph not found');
    expect(readCount(intro, /publishes to (\w+) networks/)).toBe(SOCIAL_PROVIDERS.length);
  });

  it('states the direct-connect count from DIRECT_CONNECT_PROVIDERS', () => {
    const direct = paragraphTexts().find((text) => text.includes('connect directly'));
    if (direct === undefined) throw new Error('integrations direct-connect paragraph not found');
    expect(readCount(direct, /(\w+) networks connect directly/)).toBe(DIRECT_CONNECT_PROVIDERS.length);
  });
});
