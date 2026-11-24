import type { IdentityCard, Scene } from '@/lib/contracts/persona-identity-card';

export const FIXTURE_CARD: IdentityCard = {
  version: 1,
  identity: {
    face: {
      shape: 'oval',
      eyes: 'blue-grey, wide-set',
      eyebrows: 'straight, medium',
      nose: 'straight, narrow',
      lips: 'full, natural pink',
      skin: 'fair, light freckles',
      hair: { color: 'blonde', style: 'long wavy', length: 'past shoulders' },
    },
    body: {
      build: 'athletic, toned',
      height: 'tall',
      shoulders: 'narrow',
      hands: 'slim, no jewelry',
    },
  },
  defaults: { outfit: { top: 'sage-green t-shirt', bottom: 'jeans' } },
};

export const FIXTURE_SCENE: Scene = {
  outfit: { top: 'navy blazer', bottom: 'grey trousers', footwear: 'running shoes' },
  pose: 'standing, facing camera',
  setting: 'city street at golden hour',
  lighting: 'golden_hour',
  framing: 'waist_up',
  aspect: '9:16',
};

export const CARD_SENTINEL = 'sentinel-eyes-7f3a';

export function cardWithSentinel(): IdentityCard {
  return {
    version: 1,
    identity: { face: { eyes: CARD_SENTINEL } },
  };
}
