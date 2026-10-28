import { describe, expect, it } from 'vitest';
import { joinSegments, validateSegments } from '../script-segments.js';

const hook =
  'Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today.';
const body =
  'Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.';
const cta = 'Save this video before your next trip to Porto.';

describe('validateSegments (MCP copy)', () => {
  it('accepts a valid hook, body and CTA and joins them with blank lines', () => {
    const segments = [
      { kind: 'hook', text: hook },
      { kind: 'body', text: body },
      { kind: 'cta', text: cta },
    ];
    const result = validateSegments(segments);
    expect(result.ok).toBe(true);
    expect(joinSegments(segments)).toBe(`${hook}\n\n${body}\n\n${cta}`);
  });

  it('rejects too many terms on a media-less segment, like the engine does', () => {
    const result = validateSegments([
      { kind: 'hook', text: hook },
      {
        kind: 'body',
        text: body,
        terms: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'],
      },
      { kind: 'cta', text: cta },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments.1.terms');
  });

  it('rejects a segment with an unknown key, like the engine does', () => {
    const result = validateSegments([
      { kind: 'hook', text: hook },
      { kind: 'body', text: body, voice: 'narrator' },
      { kind: 'cta', text: cta },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('segments.1');
  });
});
