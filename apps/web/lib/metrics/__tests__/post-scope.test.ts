import { describe, expect, it } from 'vitest';
import { postInPersonaScope } from '../post-scope';

describe('postInPersonaScope', () => {
  it.each([
    ['no scope shows a persona post', 'p1', false, null, true],
    ['no scope shows an orphaned persona-less post', null, false, null, true],
    ['a scoped persona post in scope is shown', 'p1', false, ['p1'], true],
    ['a scoped persona post out of scope is hidden', 'p2', false, ['p1'], false],
    ['a scoped voiceover post is shown', null, true, ['p1'], true],
    ['a scoped persona-less post that is not voiceover is hidden', null, false, ['p1'], false],
    ['an empty scope hides persona posts', 'p1', false, [], false],
    ['an empty scope shows voiceover posts', null, true, [], true],
  ])('%s', (_name, personaId, voiceover, scope, expected) => {
    expect(postInPersonaScope(personaId, voiceover, scope)).toBe(expected);
  });
});
