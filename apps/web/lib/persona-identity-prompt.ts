import {
  OUTFIT_SLOTS,
  type IdentityCard,
  type Outfit,
  type Scene,
} from './contracts/persona-identity-card';

export interface IdentityPrompt {
  prompt: string;
  suggestedDescription: string;
}

const REFERENCE_LINE = "Edit the reference photo. Keep the person's face and body exactly as in the reference photo.";
const CLOSING_LINE = 'Do not change the face, hair, eyes, skin, body build or height.';
const KEEP_OUTFIT_LINE = 'Outfit: keep the outfit from the reference photo.';
const SUGGESTED_DESCRIPTION_MAX = 500;

const LIGHTING_LABELS: Record<Scene['lighting'], string> = {
  soft_daylight: 'soft daylight',
  golden_hour: 'golden hour',
  overcast: 'overcast',
  studio: 'studio',
  warm_indoor: 'warm indoor',
  night_city: 'night city',
};

const FRAMING_SHOTS: Record<Scene['framing'], string> = {
  close_up: 'close-up shot',
  head_and_shoulders: 'head-and-shoulders shot',
  waist_up: 'waist-up shot',
  full_body: 'full-body shot',
};

const FRAMING_WORDS: Record<Scene['framing'], string> = {
  close_up: 'close up',
  head_and_shoulders: 'head and shoulders',
  waist_up: 'waist up',
  full_body: 'full body',
};

const OUTFIT_SLOT_LABELS: Record<(typeof OUTFIT_SLOTS)[number], string> = {
  top: 'top',
  bottom: 'bottom',
  one_piece: 'one-piece',
  outerwear: 'outerwear',
  footwear: 'footwear',
  accessories: 'accessories',
};

function identityParts(card: IdentityCard): string[] {
  const { face, body } = card.identity;
  const candidates: Array<[string, string | undefined]> = [
    ['face shape', face?.shape],
    ['eyes', face?.eyes],
    ['eyebrows', face?.eyebrows],
    ['nose', face?.nose],
    ['lips', face?.lips],
    ['skin', face?.skin],
    ['hair color', face?.hair?.color],
    ['hair style', face?.hair?.style],
    ['hair length', face?.hair?.length],
    ['facial hair', face?.facial_hair],
    ['marks', face?.marks],
    ['body build', body?.build],
    ['height', body?.height],
    ['shoulders', body?.shoulders],
    ['hands', body?.hands],
  ];
  return candidates.flatMap(([label, value]) => (value === undefined ? [] : [`${label}: ${value}`]));
}

function outfitValues(outfit: Outfit): string[] {
  return OUTFIT_SLOTS.flatMap((slot) => {
    const value = outfit[slot];
    return value === undefined ? [] : [value];
  });
}

function outfitParts(outfit: Outfit): string[] {
  return OUTFIT_SLOTS.flatMap((slot) => {
    const value = outfit[slot];
    return value === undefined ? [] : [`${OUTFIT_SLOT_LABELS[slot]}: ${value}`];
  });
}

function resolveOutfit(card: IdentityCard, scene: Scene): Outfit | undefined {
  return scene.outfit ?? card.defaults?.outfit;
}

function clampDescription(words: string[]): string {
  const joined = words.join(', ');
  if (joined.length <= SUGGESTED_DESCRIPTION_MAX) return joined;
  const cut = joined.slice(0, SUGGESTED_DESCRIPTION_MAX);
  const boundary = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  return (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/[,\s]+$/, '');
}

export function buildIdentityPrompt(card: IdentityCard, scene: Scene): IdentityPrompt {
  const outfit = resolveOutfit(card, scene);
  const lines: string[] = [REFERENCE_LINE];

  const identity = identityParts(card);
  if (identity.length > 0) lines.push(`Person: ${identity.join('; ')}.`);
  lines.push(outfit === undefined ? KEEP_OUTFIT_LINE : `Outfit: ${outfitParts(outfit).join('; ')}.`);
  if (scene.pose !== undefined) lines.push(`Pose: ${scene.pose}.`);
  if (scene.setting !== undefined) lines.push(`Setting: ${scene.setting}.`);
  lines.push(`Lighting: ${LIGHTING_LABELS[scene.lighting]}.`);
  lines.push(
    scene.aspect === undefined
      ? `Framing: ${FRAMING_SHOTS[scene.framing]}.`
      : `Framing: ${FRAMING_SHOTS[scene.framing]}, ${scene.aspect} aspect ratio.`,
  );
  lines.push(CLOSING_LINE);

  const descriptionWords = [
    ...(outfit === undefined ? [] : outfitValues(outfit)),
    ...(scene.setting === undefined ? [] : [scene.setting]),
    `${LIGHTING_LABELS[scene.lighting]} lighting`,
    FRAMING_WORDS[scene.framing],
  ];

  return { prompt: lines.join('\n'), suggestedDescription: clampDescription(descriptionWords) };
}
