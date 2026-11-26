import { describe, expect, it } from 'vitest';
import { mentionsIdentity } from '@/lib/contracts/persona-identity-card-filter';
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

  it.each([
    'arms crossed, long legs',
    'smiling with perfect teeth',
    'legs crossed, wide hips',
    'arms crossed and a strong jawline',
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
