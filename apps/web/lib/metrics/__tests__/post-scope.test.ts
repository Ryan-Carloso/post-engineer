import { describe, expect, it } from 'vitest';
import { postInPersonaScope } from '../post-scope';

describe('postInPersonaScope', () => {
  it.each([
    ['no scope shows a persona post', 'p1', null, true],
    ['no scope shows a persona-less post', null, null, true],
    ['a scoped persona post in scope is shown', 'p1', ['p1'], true],
    ['a scoped persona post out of scope is hidden', 'p2', ['p1'], false],
    ['a scoped caller never sees a persona-less post', null, ['p1'], false],
    ['an empty scope hides persona posts', 'p1', [], false],
    ['an empty scope hides persona-less posts', null, [], false],
  ])('%s', (_name, personaId, scope, expected) => {
    expect(postInPersonaScope(personaId, scope)).toBe(expected);
  });
});
