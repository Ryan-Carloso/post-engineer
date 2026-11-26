const IDENTITY_WORDS: ReadonlySet<string> = new Set([
  'hair', 'eye', 'eyes', 'skin', 'build', 'builds', 'height', 'heights', 'beard', 'bearded', 'muscular',
  'tattoo', 'tattoos', 'tattooed', 'freckles', 'freckled', 'body', 'bodies', 'face', 'faces', 'taller', 'thinner',
  'smile', 'teeth', 'arms', 'legs', 'hips', 'waist', 'posture', 'jawline', 'cheekbones', 'chin', 'forehead', 'ears',
  'arm', 'leg', 'hip', 'ear', 'tooth',
]);

const IDENTITY_STEMS: readonly string[] = ['hair', 'eye', 'skin', 'freckl', 'tattoo', 'beard'];

const IDENTITY_EXTRA_WORDS: ReadonlySet<string> = new Set([
  'blonde', 'brunette', 'redhead', 'ginger', 'bald', 'abs',
  'cabelo', 'loiro', 'loira', 'ruivo', 'ruiva', 'careca', 'calvo',
]);

const HARMLESS_CLOTHING_WORDS: readonly RegExp[] = [
  /\b(?:body|bodies) of water\b/g,
  /\b(?:skinny|skintight|eyewear|eyeglasses|eyelet)\b/g,
];

const ALLOWED_POSE_OUTFIT_PHRASES: readonly RegExp[] = [
  /\barms[\s-]+crossed\b/g,
  /\blegs[\s-]+crossed\b/g,
  /\bsmiling\b/g,
  /\bsmile at the camera\b/g,
  /\bhigh[\s-]+waist(?:ed)?\b/g,
  /\bhip[\s-]+bag\b/g,
  /\b(?:wide|straight|flared|tapered|bootcut|cropped|slim|skinny)[\s-]+leg\b/g,
  /\bhip[\s-]+length\b/g,
  /\bhip[\s-]+hop\b/g,
  /\b(?:arm|leg)[\s-]+warmers\b/g,
  /\bear[\s-]+muffs\b/g,
];

const HARMLESS_SCENE_PHRASES: readonly RegExp[] = [
  /\bginger tea\b/g,
  /\bbald eagle\b/g,
  /\bsheer curtains\b/g,
  /\btransparent glass\b/g,
];

const SCENE_IDENTITY_WORDS: ReadonlySet<string> = new Set(['skinny']);

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function stripHarmless(value: string, scene: boolean): string {
  const lowered = normalizeText(value).toLowerCase();
  const stripped = [...ALLOWED_POSE_OUTFIT_PHRASES, ...HARMLESS_CLOTHING_WORDS].reduce(
    (text, phrase) => text.replace(phrase, ' '),
    lowered,
  );
  return scene
    ? HARMLESS_SCENE_PHRASES.reduce((text, phrase) => text.replace(phrase, ' '), stripped)
    : stripped;
}

export function mentionsIdentity(value: string, scene = false): boolean {
  if (scene && wordsOf(value).some((word) => SCENE_IDENTITY_WORDS.has(word))) return true;
  return wordsOf(stripHarmless(value, scene)).some(
    (word) =>
      IDENTITY_WORDS.has(word) ||
      IDENTITY_EXTRA_WORDS.has(word) ||
      IDENTITY_STEMS.some((stem) => word.startsWith(stem)),
  );
}

export const SEXUALISED_WORDS: ReadonlySet<string> = new Set([
  'nude', 'naked', 'nudity', 'topless', 'bottomless', 'shirtless', 'lingerie', 'bikini', 'underwear', 'thong',
  'undressed', 'sexy', 'sexual', 'erotic', 'nsfw', 'revealing', 'transparent', 'sheer',
]);

function wordsOf(value: string): string[] {
  return normalizeText(value).toLowerCase().split(/[^a-z]+/).filter((word) => word.length > 0);
}

export function mentionsAny(value: string, words: ReadonlySet<string>, scene = false): boolean {
  return wordsOf(stripHarmless(value, scene)).some((word) => words.has(word));
}

export function mentionsSeeThrough(value: string): boolean {
  return /see[\s-]*through/i.test(value);
}
