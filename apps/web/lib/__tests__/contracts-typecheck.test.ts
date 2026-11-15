import { describe, expect, it } from 'vitest';
import { readBody } from '@/lib/contracts-server';
import { createExperiment } from '@/lib/contracts/experiments';
import { getPrompt, listPrompts } from '@/lib/contracts/prompts';
import type { BodyOf, ResponseOf } from '@/lib/contracts/endpoint';

//---------------
// Type-level pins for the shared contracts (web side, mirroring
// apps/mcp/src/__tests__/contracts-typecheck.test.ts): renaming a
// contract field makes this file fail typecheck. The @ts-expect-error
// pins must stay errors.
//---------------

type CreateBody = BodyOf<typeof createExperiment>;
type CreateResponse = ResponseOf<typeof createExperiment>;
type ListPromptsResponse = ResponseOf<typeof listPrompts>;
type GetPromptResponse = ResponseOf<typeof getPrompt>;

describe('contracts typecheck', () => {
  it('pins BodyOf and ResponseOf field names', async () => {
    const validBody: CreateBody = {
      name: 'Hook test',
      variable: 'hook',
      targetPairs: 6,
      variants: [
        { variantId: 'hook-calm', name: 'Calm', description: 'calm' },
        { variantId: 'hook-aggressive', name: 'Aggressive', description: 'direct' },
      ],
    };
    expect(validBody.name).toBe('Hook test');

    // @ts-expect-error -- strict body: `nome` is not a field of the create body
    const badBody: CreateBody = { nome: 'x', variable: 'hook', targetPairs: 6, variants: [] };
    expect(badBody).toBeDefined();

    const response = { success: true, experiment: { id: '1', name: 'Hook test', variable: 'hook', personaId: '11111111-2222-4333-8444-555555555555' as string | null, targetPairs: 6, variants: [] } } as CreateResponse;
    expect(response.experiment.name).toBe('Hook test');

    // @ts-expect-error -- response experiment field is `name`, not `nome`
    const badName = response.experiment.nome;
    expect(badName).toBeUndefined();

    const request = new Request('http://localhost/api/experiments', { method: 'POST', body: JSON.stringify(validBody) });
    const result = await readBody(createExperiment, request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.body.name).toBe('Hook test');
      // @ts-expect-error -- readBody body field is `name`, not `nome`
      expect(result.body.nome).toBeUndefined();
    }
  });

  it('pins the prompts response field names', () => {
    const list: ListPromptsResponse = { success: true, prompts: [{ slug: 'daily-news', title: 'News', description: 'News' }] };
    expect(list.prompts[0]?.title).toBe('News');
    // @ts-expect-error -- the list item field is `title`, not `name`
    expect(list.prompts[0]?.name).toBeUndefined();

    const detail: GetPromptResponse = { success: true, prompt: { slug: 'daily-news', title: 'News', description: 'News', prompt: 'Write...' } };
    expect(detail.prompt.prompt).toBe('Write...');
    // @ts-expect-error -- the detail field is `prompt`, not `text`
    expect(detail.prompt.text).toBeUndefined();
  });
});
