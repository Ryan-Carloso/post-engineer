// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { registeredToolActions, registeredToolNames } from '@/test/mcp-tool-names';

describe('mcp tool inventory helper', () => {
  it('maps every registered tool to its actions, with none missing or extra', () => {
    const names = registeredToolNames(import.meta.url);
    const actions = registeredToolActions(import.meta.url);

    expect(names.length).toBeGreaterThan(0);
    expect(Object.keys(actions).sort()).toEqual(names);
  });

  it('reads the actions of tools that spread another spec object', () => {
    const actions = registeredToolActions(import.meta.url);

    expect(actions.prompts).toEqual(
      expect.arrayContaining(['list', 'get', 'create', 'update', 'delete', 'versions', 'restore']),
    );
    expect(actions.insights).toContain('retention_curve');
    expect(actions.generate_video).toEqual([]);
  });
});
