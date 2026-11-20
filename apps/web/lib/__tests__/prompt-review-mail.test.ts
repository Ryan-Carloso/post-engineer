import { describe, expect, it, vi } from 'vitest';
import { notifyReviewersOfPendingPrompt, renderPendingPromptEmail } from '@/lib/prompt-review-mail';

vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));

const env = { apiKey: 're_test', from: '"Post Engineer <alerts@example.com>"' };

function okFetch() {
  return vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }));
}

describe('notifyReviewersOfPendingPrompt', () => {
  it('sends one email to every reviewer with the slug, the title and a link to the queue', async () => {
    const fetchFn = okFetch();
    await notifyReviewersOfPendingPrompt(
      { slug: 'my-prompt', title: 'My prompt' },
      { fetchFn, env, loadRecipients: async () => ['a@example.com', 'b@example.com'] },
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({
      from: 'Post Engineer <alerts@example.com>',
      to: ['a@example.com', 'b@example.com'],
      subject: 'Prompt waiting for review: My prompt',
    });
    expect(String(sent.text)).toContain('/admin/prompts');
    expect(String(sent.text)).toContain('my-prompt');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
  });

  it('does nothing when Resend is not configured', async () => {
    const fetchFn = okFetch();
    const loadRecipients = vi.fn(async () => ['a@example.com']);
    await notifyReviewersOfPendingPrompt({ slug: 's', title: 't' }, { fetchFn, env: { apiKey: '', from: '' }, loadRecipients });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(loadRecipients).not.toHaveBeenCalled();
  });

  it('does not send when no reviewer has an email', async () => {
    const fetchFn = okFetch();
    await notifyReviewersOfPendingPrompt({ slug: 's', title: 't' }, { fetchFn, env, loadRecipients: async () => [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('never throws when Resend rejects the email or the request fails', async () => {
    const rejected = vi.fn<typeof fetch>(async () => new Response('no', { status: 422 }));
    await expect(
      notifyReviewersOfPendingPrompt({ slug: 's', title: 't' }, { fetchFn: rejected, env, loadRecipients: async () => ['a@example.com'] }),
    ).resolves.toBeUndefined();
    const broken = vi.fn<typeof fetch>(async () => {
      throw new Error('network down');
    });
    await expect(
      notifyReviewersOfPendingPrompt({ slug: 's', title: 't' }, { fetchFn: broken, env, loadRecipients: async () => ['a@example.com'] }),
    ).resolves.toBeUndefined();
  });

  it('never throws when loading the reviewers fails', async () => {
    await expect(
      notifyReviewersOfPendingPrompt(
        { slug: 's', title: 't' },
        { fetchFn: okFetch(), env, loadRecipients: async () => { throw new Error('PROMPT_REVIEWER_USER_IDS is not set'); } },
      ),
    ).resolves.toBeUndefined();
  });
});

describe('renderPendingPromptEmail', () => {
  it('escapes the title in the html and keeps the subject on one line', () => {
    const message = renderPendingPromptEmail({ slug: 's', title: '<script>alert(1)</script>\nsecond line' }, 'https://post-engineer.test/admin/prompts');
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
    expect(message.subject).not.toContain('\n');
    expect(message.text).toContain('https://post-engineer.test/admin/prompts');
  });
});
