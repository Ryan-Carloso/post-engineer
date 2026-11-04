import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireSupabaseSession = vi.hoisted(() => vi.fn());
vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession }));
vi.mock('@/lib/api-error-reporting', () => ({
  withApiErrorReporting: (_route: string, handler: unknown) => handler,
  resolveReportingUserId: vi.fn(),
}));

import { GET as listPrompts } from '../route';
import { GET as getPrompt } from '../[slug]/route';
import { PROMPTS } from '@/app/recipes/prompts';
import { recipesI18nEn } from '@/lib/i18n/recipes-i18n-en';
import { DAILY_NEWS_PROMPT } from '@/lib/generation/prompt-base';

//---------------
// GET /api/prompts and GET /api/prompts/[slug] — recipe prompts served to
// the MCP from the web hub (PROMPTS + English recipes copy).
//---------------

function authenticated(): void {
  requireSupabaseSession.mockResolvedValue({ auth: { userId: 'user-1', accessToken: 't', isApiKey: true }, error: null });
}

function request(path: string): Request {
  return new Request(`https://post-engineer.test${path}`, { headers: { authorization: 'Bearer pe_test' } });
}

function slugContext(slug: string): { params: Promise<{ slug: string }> } {
  return { params: Promise.resolve({ slug }) };
}

describe('GET /api/prompts', () => {
  beforeEach(() => {
    requireSupabaseSession.mockReset();
  });

  it('returns 401 without auth', async () => {
    requireSupabaseSession.mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }),
    });
    const response = await listPrompts(request('/api/prompts'));
    expect(response.status).toBe(401);
  });

  it('lists every hub prompt in order with the English title and description, without prompt text', async () => {
    authenticated();
    const response = await listPrompts(request('/api/prompts'));
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toEqual({
      success: true,
      prompts: PROMPTS.map((entry) => ({
        slug: entry.slug,
        title: expect.any(String),
        description: expect.any(String),
      })),
    });
    expect(JSON.stringify(body)).not.toContain(DAILY_NEWS_PROMPT.slice(0, 200));
    expect(body).toMatchObject({
      prompts: expect.arrayContaining([
        {
          slug: 'daily-news',
          title: recipesI18nEn.dailyNewsTitle,
          description: recipesI18nEn.dailyNewsObjective,
        },
      ]),
    });
  });
});

describe('GET /api/prompts/[slug]', () => {
  beforeEach(() => {
    requireSupabaseSession.mockReset();
  });

  it('returns 401 without auth and never reads the slug', async () => {
    const params = vi.fn();
    requireSupabaseSession.mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }),
    });
    const context = { get params(): Promise<{ slug: string }> { params(); return Promise.resolve({ slug: 'daily-news' }); } };
    const response = await getPrompt(request('/api/prompts/daily-news'), context);
    expect(response.status).toBe(401);
    expect(params).not.toHaveBeenCalled();
  });

  it('returns the full recipe for a known slug', async () => {
    authenticated();
    const response = await getPrompt(request('/api/prompts/daily-news'), slugContext('daily-news'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      prompt: {
        slug: 'daily-news',
        title: recipesI18nEn.dailyNewsTitle,
        description: recipesI18nEn.dailyNewsObjective,
        prompt: DAILY_NEWS_PROMPT,
      },
    });
  });

  it('decodes a percent-encoded slug before matching', async () => {
    authenticated();
    const response = await getPrompt(request('/api/prompts/daily%2Dnews'), slugContext('daily%2Dnews'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ prompt: { slug: 'daily-news' } });
  });

  it('returns 400 on a malformed percent-encoding', async () => {
    authenticated();
    const response = await getPrompt(request('/api/prompts/%E0%A4%A'), slugContext('%E0%A4%A'));
    expect(response.status).toBe(400);
  });

  it('returns 404 with the PROMPT_NOT_FOUND code for an unknown slug', async () => {
    authenticated();
    const response = await getPrompt(request('/api/prompts/nope'), slugContext('nope'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Unknown prompt slug.',
      code: 'PROMPT_NOT_FOUND',
    });
  });
});
