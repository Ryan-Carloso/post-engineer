import { describe, expect, it } from 'vitest';
import { segmentsRequestSchema } from '../segments-schema';

const segment = (media: unknown) => [{ kind: 'body', text: 'Where the river meets the sea.', media }];

describe('segmentsRequestSchema overlay', () => {
  it('keeps a card on the parsed segment so it reaches the engine', () => {
    const parsed = segmentsRequestSchema.parse(
      segment({ url: 'https://example.com/x.jpg', overlay: { title: 'Sushi', subtitle: 'Rua das Flores', badge: '35 EUR' } }),
    );
    expect(parsed[0].media?.overlay).toEqual({ title: 'Sushi', subtitle: 'Rua das Flores', badge: '35 EUR' });
  });

  it.each([
    ['an unknown key in the card', { url: 'https://example.com/x.jpg', overlay: { title: 'Sushi', price: '1' } }],
    ['a card without a title', { url: 'https://example.com/x.jpg', overlay: { subtitle: 'x' } }],
    ['an unknown key next to the card', { url: 'https://example.com/x.jpg', overlay: { title: 'x' }, alt: 'kitchen' }],
    ['a non-string title', { url: 'https://example.com/x.jpg', overlay: { title: 5 } }],
  ])('rejects %s instead of stripping it', (_name, media) => {
    expect(segmentsRequestSchema.safeParse(segment(media)).success).toBe(false);
  });
});
