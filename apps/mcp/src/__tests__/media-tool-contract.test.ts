import { describe, expect, it } from 'vitest';
import { MediaCheckBodySchema } from '../contracts/media.js';
import { CheckMediaSchema } from '../tools-user-media.js';

type MediaCheckCase = { args: Record<string, string>; accept: boolean };

const CASES: MediaCheckCase[] = [
  { args: { url: 'https://e.com/porto.jpg' }, accept: true },
  { args: { url: 'https://e.com/porto.jpg', videoAspect: '9:16' }, accept: true },
  { args: { url: 'https://e.com/porto.jpg', videoAspect: '1:1' }, accept: true },
  { args: { url: '' }, accept: false },
  { args: { url: 'ftp://e.com/porto.jpg' }, accept: false },
  { args: { url: 'not-a-url' }, accept: false },
  { args: { url: 'https://e.com/porto.jpg', videoAspect: '4:3' }, accept: false },
];

describe('media check tool schema agrees with the shared contract', () => {
  it.each(CASES)('tool and contract agree on $args', ({ args, accept }) => {
    expect(CheckMediaSchema.safeParse(args).success).toBe(accept);
    expect(MediaCheckBodySchema.safeParse(args).success).toBe(accept);
  });

  it('a missing url is rejected by both', () => {
    expect(CheckMediaSchema.safeParse({}).success).toBe(false);
    expect(MediaCheckBodySchema.safeParse({}).success).toBe(false);
  });
});
