import { describe, it, expect } from 'vitest';
import { getPrompt } from '../prompts';
import { SHARED_PROMPT_BASE } from '@/lib/generation/prompt-base';

describe('tool-config prompt', () => {
  it('checks the saved configuration before asking which search tool', () => {
    const base = SHARED_PROMPT_BASE.join('\n');
    expect(base).toContain('First check the saved tool configuration with tool_config');
    expect(base).toContain('tool_config (action: get)');
    expect(base).toContain('Ask me once which search tool you already have');
    expect(base).toContain('tool_config (action: save)');
    expect(base).toContain('so the next conversation does not ask again');
    expect(base.indexOf('tool_config (action: get)')).toBeLessThan(
      base.indexOf('Ask me once which search tool'),
    );
  });

  it('asks only for what is missing and saves the answers in setup', () => {
    const fullText = getPrompt('full-setup')?.prompt ?? '';
    const baseText = SHARED_PROMPT_BASE.join('\n');
    expect(fullText.startsWith(baseText)).toBe(true);
    const text = fullText.slice(baseText.length + 2);
    expect(text).toContain('Check the saved tool configuration first with tool_config');
    expect(text).toContain('Ask once, and only for what is missing');
    expect(text).toContain('tool_config (action: save)');
    expect(text).toContain('are stored encrypted and are never shown back in full');
    expect(text).toContain('a later session reuses them instead of asking again');
    expect(text.indexOf('tool_config (action: get)')).toBeLessThan(
      text.indexOf('tool_config (action: save)'),
    );
  });

  it('no longer claims there is no saved configuration', () => {
    const fullText = getPrompt('full-setup')?.prompt ?? '';
    expect(fullText).not.toContain('There is no saved account configuration');
    expect(fullText).not.toContain('never claim the answers were saved');
    expect(fullText).not.toContain('There is no saved tool configuration');
  });
});
