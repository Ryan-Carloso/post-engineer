const IDENTITY_WORDS: ReadonlySet<string> = new Set([
  'hair', 'eye', 'eyes', 'skin', 'build', 'builds', 'height', 'heights', 'beard', 'bearded', 'muscular',
  'tattoo', 'tattoos', 'tattooed', 'freckles', 'freckled', 'body', 'bodies', 'face', 'faces', 'taller', 'thinner',
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

const HARMLESS_SCENE_PHRASES: readonly RegExp[] = [
  /\bginger tea\b/g,
  /\bbald eagle\b/g,
  /\bsheer curtains\b/g,
  /\btransparent glass\b/g,
];

const SCENE_IDENTITY_WORDS: ReadonlySet<string> = new Set(['skinny']);

function stripHarmless(value: string, scene: boolean): string {
  const lowered = value.toLowerCase();
  const stripped = HARMLESS_CLOTHING_WORDS.reduce((text, phrase) => text.replace(phrase, ' '), lowered);
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
  return value.toLowerCase().split(/[^a-z]+/).filter((word) => word.length > 0);
}

export function mentionsAny(value: string, words: ReadonlySet<string>, scene = false): boolean {
  return wordsOf(stripHarmless(value, scene)).some((word) => words.has(word));
}

export function mentionsSeeThrough(value: string): boolean {
  return /see[\s-]*through/i.test(value);
}
