// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';

const robots = readFileSync(
  join(findRepoRoot(import.meta.url), 'apps', 'web', 'public', 'robots.txt'),
  'utf8',
);

const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Meta-ExternalAgent',
  'Amazonbot',
];

const SOCIAL_BOTS = ['facebookexternalhit', 'Twitterbot', 'LinkedInBot', 'WhatsApp'];

const KNOWN_DIRECTIVES = ['user-agent', 'allow', 'disallow', 'crawl-delay', 'sitemap'];

interface Group {
  agents: string[];
  allow: string[];
  disallow: string[];
  crawlDelay: string[];
}

function directiveLines(): Array<{ directive: string; value: string }> {
  return robots
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const colon = line.indexOf(':');
      return {
        directive: line.slice(0, colon).trim().toLowerCase(),
        value: line.slice(colon + 1).trim(),
      };
    });
}

function parseGroups(): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let collectingAgents = false;
  for (const { directive, value } of directiveLines()) {
    if (directive === 'sitemap') continue;
    if (directive === 'user-agent') {
      if (current === null || !collectingAgents) {
        current = { agents: [], allow: [], disallow: [], crawlDelay: [] };
        groups.push(current);
      }
      current.agents.push(value);
      collectingAgents = true;
      continue;
    }
    collectingAgents = false;
    if (current === null) throw new Error(`rule before any User-agent: ${directive}`);
    if (directive === 'allow') current.allow.push(value);
    if (directive === 'disallow') current.disallow.push(value);
    if (directive === 'crawl-delay') current.crawlDelay.push(value);
  }
  return groups;
}

function groupFor(agent: string): Group {
  const found = parseGroups().filter((group) => group.agents.includes(agent));
  expect(found, agent).toHaveLength(1);
  return found[0];
}

describe('robots.txt', () => {
  const wildcard = groupFor('*');

  it('has a wildcard group with Disallow rules to copy', () => {
    expect(wildcard.disallow.length).toBeGreaterThan(5);
  });

  it.each(AI_CRAWLERS)('names the AI crawler %s in its own group', (agent) => {
    const group = groupFor(agent);
    expect(group.agents).toEqual([agent]);
    expect(group.allow).toContain('/');
  });

  it.each([...AI_CRAWLERS, ...SOCIAL_BOTS])(
    'gives %s every Disallow rule of the wildcard group',
    (agent) => {
      expect(groupFor(agent).disallow).toEqual(expect.arrayContaining(wildcard.disallow));
    },
  );

  it.each([...AI_CRAWLERS, ...SOCIAL_BOTS])(
    'repeats the wildcard Crawl-delay in the %s group, which does not inherit it',
    (agent) => {
      expect(wildcard.crawlDelay).toEqual(['1']);
      expect(groupFor(agent).crawlDelay).toEqual(wildcard.crawlDelay);
    },
  );

  it('points AI crawlers at llms.txt and llms-full.txt in a comment', () => {
    const comment = robots
      .split('\n')
      .find((line) => line.startsWith('#') && line.includes('llms.txt'));
    expect(comment).toBeDefined();
    expect(comment).toContain('https://post-engineer.com/llms.txt');
    expect(comment).toContain('llms-full.txt');
  });

  it('uses only directives that robots.txt defines', () => {
    for (const { directive } of directiveLines()) {
      expect(KNOWN_DIRECTIVES, directive).toContain(directive);
    }
  });

  it('keeps the sitemap reference', () => {
    expect(robots).toContain('Sitemap: https://post-engineer.com/sitemap.xml');
  });
});
