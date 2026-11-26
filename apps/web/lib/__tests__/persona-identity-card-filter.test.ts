import { describe, expect, it } from 'vitest';
import { mentionsAny, mentionsIdentity, SEXUALISED_WORDS } from '@/lib/contracts/persona-identity-card-filter';
import { parseIdentityCardValue, parseSceneValue } from '@/lib/contracts/persona-identity-card';
import { FIXTURE_SCENE } from '@/test/identity-card-fixtures';

const NEW_IDENTITY_CLAIMS = [
  'wide hips',
  'long legs',
  'big smile',
  'perfect teeth',
  'slim waist',
  'strong jawline',
  'high cheekbones',
  'pointed chin',
  'wide forehead',
  'small ears',
  'toned arms',
  'good posture',
  'long leg',
  'big hip',
  'toned arm',
  'small ear',
  'crooked tooth',
];

const ALLOWED_PHRASES = [
  'arms crossed',
  'legs crossed',
  'smiling',
  'smile at the camera',
  'high waist trousers',
  'high-waisted jeans',
  'Arms Crossed, looking away',
  'legs-crossed on a bench',
];

describe('scene filter for the v2 identity words', () => {
  it.each(NEW_IDENTITY_CLAIMS)('rejects the bare identity claim "%s" in a pose', (text) => {
    const result = parseSceneValue({ ...FIXTURE_SCENE, pose: text });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('scene.pose: must describe the scene only, not the person (face, hair, skin, body)');
      expect(result.error).not.toContain(text);
    }
  });

  it.each(NEW_IDENTITY_CLAIMS)('rejects the bare identity claim "%s" in a setting', (text) => {
    expect(parseSceneValue({ ...FIXTURE_SCENE, setting: text }).ok).toBe(false);
  });

  it.each(NEW_IDENTITY_CLAIMS)('rejects the bare identity claim "%s" in a scene outfit slot', (text) => {
    const result = parseSceneValue({ ...FIXTURE_SCENE, outfit: { top: text } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.startsWith('scene.outfit.top:')).toBe(true);
  });

  it.each(NEW_IDENTITY_CLAIMS)('rejects the bare identity claim "%s" in a default outfit slot', (text) => {
    const result = parseIdentityCardValue({
      version: 2,
      identity: { face: { eyes: 'green' } },
      defaults: { outfit: { bottom: text } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.startsWith('identityCard.defaults.outfit.bottom:')).toBe(true);
  });

  it.each(ALLOWED_PHRASES)('accepts the allowlisted phrase "%s" in a pose', (text) => {
    expect(parseSceneValue({ ...FIXTURE_SCENE, pose: text }).ok).toBe(true);
  });

  it.each(['high waist trousers', 'high-waisted jeans', 'High Waist skirt'])(
    'accepts the allowlisted phrase "%s" in an outfit slot',
    (text) => {
      expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: text } }).ok).toBe(true);
    },
  );

  it.each(['high waist trousers', 'high-waisted jeans', 'High Waist skirt'])(
    'accepts the allowlisted phrase "%s" in a default outfit slot',
    (text) => {
      const result = parseIdentityCardValue({
        version: 2,
        identity: { face: { eyes: 'green' } },
        defaults: { outfit: { bottom: text } },
      });
      expect(result.ok).toBe(true);
    },
  );

  it.each(['wide-leg trousers', 'wide leg jeans', 'straight-leg jeans', 'hip-length jacket'])(
    'accepts the allowlisted phrase "%s" in an outfit slot',
    (text) => {
      expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: text } }).ok).toBe(true);
    },
  );

  it.each(['wide-leg trousers', 'wide leg jeans', 'straight-leg jeans', 'hip-length jacket'])(
    'accepts the allowlisted phrase "%s" in a default outfit slot',
    (text) => {
      const result = parseIdentityCardValue({
        version: 2,
        identity: { face: { eyes: 'green' } },
        defaults: { outfit: { bottom: text } },
      });
      expect(result.ok).toBe(true);
    },
  );

  it.each([
    'flared-leg jeans',
    'flared leg trousers',
    'tapered-leg pants',
    'bootcut-leg jeans',
    'cropped-leg trousers',
    'slim-leg jeans',
    'skinny-leg jeans',
  ])('accepts the allowlisted phrase "%s" in an outfit slot', (text) => {
    expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: text } }).ok).toBe(true);
  });

  it.each([
    'flared-leg jeans',
    'flared leg trousers',
    'tapered-leg pants',
    'bootcut-leg jeans',
    'cropped-leg trousers',
    'slim-leg jeans',
    'skinny-leg jeans',
  ])('accepts the allowlisted phrase "%s" in a default outfit slot', (text) => {
    const result = parseIdentityCardValue({
      version: 2,
      identity: { face: { eyes: 'green' } },
      defaults: { outfit: { bottom: text } },
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    'relaxed-leg jeans',
    'loose-leg trousers',
    'carrot-leg trousers',
    'barrel-leg jeans',
    'balloon-leg trousers',
    'peg-leg trousers',
    'cigarette-leg pants',
    'baggy-leg jeans',
    'boyfriend-leg jeans',
    'mom-leg jeans',
    'stovepipe-leg trousers',
    'relaxed leg jeans',
    'loose leg trousers',
  ])('accepts the generalised cut phrase "%s" in an outfit slot', (text) => {
    expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: text } }).ok).toBe(true);
  });

  it.each([
    'relaxed-leg jeans',
    'loose-leg trousers',
    'carrot-leg trousers',
    'barrel-leg jeans',
    'balloon-leg trousers',
    'peg-leg trousers',
    'cigarette-leg pants',
    'baggy-leg jeans',
    'boyfriend-leg jeans',
    'mom-leg jeans',
    'stovepipe-leg trousers',
    'relaxed leg jeans',
    'loose leg trousers',
  ])('accepts the generalised cut phrase "%s" in a default outfit slot', (text) => {
    const result = parseIdentityCardValue({
      version: 2,
      identity: { face: { eyes: 'green' } },
      defaults: { outfit: { bottom: text } },
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    'long',
    'short',
    'big',
    'small',
    'thin',
    'thick',
    'fat',
    'muscular',
    'toned',
    'bare',
    'shapely',
    'hairy',
    'smooth',
    'strong',
    'weak',
    'left',
    'right',
    'broken',
    'injured',
    'swollen',
    'sore',
    'pale',
    'tanned',
  ])('still rejects the body descriptor "%s leg" in an outfit slot', (word) => {
    expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: `${word} leg` } }).ok).toBe(false);
  });

  it.each(['long-leg jeans', 'short-leg trousers', 'bare-leg jeans'])(
    'still rejects the hyphenated body descriptor "%s" in an outfit slot',
    (text) => {
      expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: text } }).ok).toBe(false);
    },
  );

  it.each([
    'her leg',
    'the leg',
    'my leg',
    'showing leg',
    'lifting leg',
    'crossing leg',
    'bending leg',
    'raising leg',
  ])('rejects the pronoun or verb phrase "%s" in an outfit slot', (text) => {
    expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: text } }).ok).toBe(false);
  });

  it.each([
    'longer leg',
    'longest leg',
    'shorter leg',
    'thinner leg',
    'taller leg',
    'slender leg',
    'lean leg',
    'lithe leg',
    'curvy leg',
    'athletic leg',
    'sculpted leg',
    'flabby leg',
    'graceful leg',
    'delicate leg',
    'longish leg',
    'barefoot leg',
    'inflamed leg',
    'bruised leg',
    'sprained leg',
    'fractured leg',
    'twisted leg',
    'veiny leg',
    'scaly leg',
    'wrinkled leg',
  ])('rejects the comparative or synonym phrase "%s" in an outfit slot', (text) => {
    expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: text } }).ok).toBe(false);
  });

  it.each(['tattooed leg', 'freckled leg', 'bearded leg', 'tattooed-leg jeans'])(
    'rejects the identity-first phrase "%s" in an outfit slot',
    (text) => {
      expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: text } }).ok).toBe(false);
    },
  );

  it.each(['sexy leg', 'sheer leg', 'revealing leg', 'transparent leg'])(
    'rejects the sexualised phrase "%s" in an outfit slot',
    (text) => {
      expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: text } }).ok).toBe(false);
    },
  );

  it.each(['sexy leg', 'sheer leg', 'revealing leg', 'transparent leg'])(
    'still flags the sexualised word in "%s" instead of stripping it away',
    (text) => {
      expect(mentionsAny(text, SEXUALISED_WORDS)).toBe(true);
      expect(mentionsIdentity(text)).toBe(true);
    },
  );

  it('rejects "her leg in the frame" in a scene setting', () => {
    expect(parseSceneValue({ ...FIXTURE_SCENE, setting: 'her leg in the frame' }).ok).toBe(false);
  });

  it.each(['her long leg', 'the left leg', 'her bare leg', 'very long leg', 'more muscular leg', 'long left leg'])(
    'still rejects the multi-word body description "%s" in an outfit slot',
    (text) => {
      expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: text } }).ok).toBe(false);
    },
  );

  it.each(['long legs', 'tattooed legs'])(
    'still rejects the plural body description "%s" in an outfit slot',
    (text) => {
      expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: text } }).ok).toBe(false);
    },
  );

  it.each(['cargo-leg jeans', 'full-leg trousers', 'slimfit-leg jeans'])(
    'rejects the non-lexicon cut "%s" in an outfit slot',
    (text) => {
      expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: text } }).ok).toBe(false);
    },
  );

  it.each(['hip bags', 'hip huggers', 'hip pockets', 'hip belts', 'hip yokes', 'hip seams'])(
    'accepts the plural garment "%s" in an outfit slot',
    (text) => {
      expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: text } }).ok).toBe(true);
    },
  );

  it.each(['hip bags', 'hip huggers', 'hip pockets', 'hip belts', 'hip yokes', 'hip seams'])(
    'accepts the plural garment "%s" in a default outfit slot',
    (text) => {
      const result = parseIdentityCardValue({
        version: 2,
        identity: { face: { eyes: 'green' } },
        defaults: { outfit: { bottom: text } },
      });
      expect(result.ok).toBe(true);
    },
  );

  it.each([
    'ear cuffs',
    'eye masks',
    'hair clips',
    'hair ties',
    'hairpins',
    'ear muff',
    'leg warmer',
    'arm warmer',
  ])('accepts the plural or singular accessory "%s" in an accessories slot', (text) => {
    expect(mentionsIdentity(text)).toBe(false);
    expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { accessories: text } }).ok).toBe(true);
  });

  it.each([
    'leg press',
    'leg curl',
    'leg press at the gym',
    'leg curls at the gym',
    'doing leg press at the gym',
  ])('accepts the bare exercise phrase "%s" in a scene setting', (text) => {
    expect(parseSceneValue({ ...FIXTURE_SCENE, setting: text }).ok).toBe(true);
  });

  it.each(['leg press', 'leg curl'])(
    'still rejects the scene-only phrase "%s" in an outfit slot',
    (text) => {
      expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: text } }).ok).toBe(false);
    },
  );

  it.each(['hip-hugger jeans', 'hip pocket jeans', 'hip seam skirt'])(
    'accepts the allowlisted phrase "%s" in an outfit slot',
    (text) => {
      expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: text } }).ok).toBe(true);
    },
  );

  it.each(['hip-hugger jeans', 'hip pocket jeans', 'hip seam skirt'])(
    'accepts the allowlisted phrase "%s" in a default outfit slot',
    (text) => {
      const result = parseIdentityCardValue({
        version: 2,
        identity: { face: { eyes: 'green' } },
        defaults: { outfit: { bottom: text } },
      });
      expect(result.ok).toBe(true);
    },
  );

  it.each(['hip-slung jeans', 'hip yoke skirt', 'hip belt jeans'])(
    'accepts the allowlisted phrase "%s" in an outfit slot',
    (text) => {
      expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: text } }).ok).toBe(true);
    },
  );

  it.each(['hip-slung jeans', 'hip yoke skirt', 'hip belt jeans'])(
    'accepts the allowlisted phrase "%s" in a default outfit slot',
    (text) => {
      const result = parseIdentityCardValue({
        version: 2,
        identity: { face: { eyes: 'green' } },
        defaults: { outfit: { bottom: text } },
      });
      expect(result.ok).toBe(true);
    },
  );

  it.each(['hip curve', 'high-hip', 'low hip', 'hip line'])(
    'still rejects the body description "%s" in an outfit slot',
    (text) => {
      expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: text } }).ok).toBe(false);
    },
  );

  it.each(['hip-hop concert', 'hip-hop street'])('accepts the allowlisted phrase "%s" in a scene setting', (text) => {
    expect(parseSceneValue({ ...FIXTURE_SCENE, setting: text }).ok).toBe(true);
  });

  it.each([
    'hairpin turn on a mountain road',
    'arm wrestling match',
    'leg day at the gym',
    'sweet tooth',
    'wooden chair leg',
    'plenty of leg room',
  ])('accepts the allowlisted phrase "%s" in a scene setting', (text) => {
    expect(parseSceneValue({ ...FIXTURE_SCENE, setting: text }).ok).toBe(true);
  });

  it.each([
    'wooden table leg',
    'metal bed leg',
    'desk leg',
    'sofa leg',
    'arm day at the gym',
    'leg press machine',
    'leg curl machine',
    'hair dryer on the table',
    'tooth fairy decoration',
    'eagle eye view',
    'eye candy on the wall',
    'arm chair in the corner',
    'arm rest on the sofa',
  ])('accepts the allowlisted phrase "%s" in a scene setting', (text) => {
    expect(parseSceneValue({ ...FIXTURE_SCENE, setting: text }).ok).toBe(true);
  });

  it.each(['skinny jeans', 'skinny-leg jeans'])('rejects "%s" in a pose', (text) => {
    expect(parseSceneValue({ ...FIXTURE_SCENE, pose: text }).ok).toBe(false);
  });

  it.each(['skinny jeans', 'skinny-leg jeans'])('rejects "%s" in a scene setting', (text) => {
    expect(parseSceneValue({ ...FIXTURE_SCENE, setting: text }).ok).toBe(false);
  });

  it('accepts "skintight dress" in a pose', () => {
    expect(parseSceneValue({ ...FIXTURE_SCENE, pose: 'skintight dress' }).ok).toBe(true);
  });

  it('still rejects "long leg" in an outfit slot', () => {
    expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { bottom: 'long leg' } }).ok).toBe(false);
  });

  it.each([
    'arms crossed, long legs',
    'smiling with perfect teeth',
    'legs crossed, wide hips',
    'arms crossed and a strong jawline',
    'wide-leg trousers, long legs',
  ])('still rejects an identity claim next to an allowlisted phrase in "%s"', (text) => {
    expect(parseSceneValue({ ...FIXTURE_SCENE, pose: text }).ok).toBe(false);
  });

  it.each(['earrings', 'leggings', 'chinos', 'armband', 'smiley badge', 'hip bag', 'ear muffs', 'leg warmers', 'arm warmers'])(
    'does not mistake the clothing word "%s" for an identity word',
    (text) => {
      expect(mentionsIdentity(text)).toBe(false);
      expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { accessories: text } }).ok).toBe(true);
    },
  );

  it.each(['gold hairpin', 'hair tie', 'hair clip', 'hairclip', 'ear cuff', 'eye mask'])(
    'accepts the accessory "%s" in an accessories slot',
    (text) => {
      expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { accessories: text } }).ok).toBe(true);
    },
  );

  it.each(['loíra', 'cabelo loíro', 'ruíva', 'cabelo ruívo'])(
    'rejects the accented identity word "%s" in a pose',
    (text) => {
      expect(parseSceneValue({ ...FIXTURE_SCENE, pose: text }).ok).toBe(false);
    },
  );

  it('rejects the accented identity word in an outfit slot', () => {
    expect(parseSceneValue({ ...FIXTURE_SCENE, outfit: { top: 'loíra' } }).ok).toBe(false);
  });
});
