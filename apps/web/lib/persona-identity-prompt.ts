import {
  OUTFIT_SLOTS,
  STYLE_PROMPT,
  type CardStyle,
  type IdentityCard,
  type IdentityLeaves,
  type Outfit,
  type Scene,
} from './contracts/persona-identity-card';

export interface IdentityPrompt {
  prompt: string;
  suggestedDescription: string;
}

const REFERENCE_LINE = "Edit the reference photo. Keep the person's face and body exactly as in the reference photo.";
const CLOSING_LINE_V1 = 'Do not change the face, hair, eyes, skin, body build or height.';
const CLOSING_LINE_V2 =
  'Do not change the face, hair, eyes, skin, body build, height, jawline, resting posture or proportions.';
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
  const identity: IdentityLeaves = card.identity;
  const { face, body } = identity;
  const candidates: Array<[string, string | undefined]> = [
    ['face shape', face?.shape],
    ['eyes', face?.eyes],
    ['eye color', face?.eye_color],
    ['eyebrows', face?.eyebrows],
    ['nose', face?.nose],
    ['lips', face?.lips],
    ['teeth', face?.teeth],
    ['smile', face?.smile],
    ['skin', face?.skin],
    ['jawline', face?.jawline],
    ['cheekbones', face?.cheekbones],
    ['chin', face?.chin],
    ['forehead', face?.forehead],
    ['ears', face?.ears],
    ['hair color', face?.hair?.color],
    ['hair style', face?.hair?.style],
    ['hair length', face?.hair?.length],
    ['hair texture', face?.hair?.texture],
    ['hair parting', face?.hair?.parting],
    ['facial hair', face?.facial_hair],
    ['marks', face?.marks],
    ['tattoos', face?.tattoos],
    ['body build', body?.build],
    ['height', body?.height],
    ['shoulders', body?.shoulders],
    ['arms', body?.arms],
    ['hands', body?.hands],
    ['waist', body?.waist],
    ['hips', body?.hips],
    ['legs', body?.legs],
    ['posture', body?.posture],
    ['proportions', body?.proportions],
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

interface StyleOutfit {
  style: CardStyle | undefined;
  outfit: Outfit | undefined;
}

function mergeOutfit(base: Outfit | undefined, override: Outfit): Outfit {
  const dropped: ReadonlySet<string> =
    override.one_piece !== undefined
      ? new Set(['top', 'bottom'])
      : override.top !== undefined || override.bottom !== undefined
        ? new Set(['one_piece'])
        : new Set();
  const merged: Outfit = {};
  for (const slot of OUTFIT_SLOTS) {
    const value = override[slot] ?? (dropped.has(slot) ? undefined : base?.[slot]);
    if (value !== undefined) merged[slot] = value;
  }
  return merged;
}

function resolveStyleOutfit(card: IdentityCard, scene: Scene): StyleOutfit {
  const defaultStyle = card.version === 2 ? card.defaults?.style : undefined;
  const defaultOutfit = card.defaults?.outfit;
  const style = scene.style ?? defaultStyle;
  if (scene.outfit === undefined) {
    return { style, outfit: scene.style === undefined ? defaultOutfit : undefined };
  }
  return { style, outfit: scene.style === undefined ? mergeOutfit(defaultOutfit, scene.outfit) : scene.outfit };
}

function namesEveryGarment(outfit: Outfit): boolean {
  const covered = outfit.one_piece !== undefined || (outfit.top !== undefined && outfit.bottom !== undefined);
  return covered && outfit.outerwear !== undefined && outfit.footwear !== undefined && outfit.accessories !== undefined;
}

function styleLine(style: CardStyle): string {
  const { label, description } = STYLE_PROMPT[style];
  return `Style: ${label} (${description}).`;
}

function outfitLine(outfit: Outfit, style: CardStyle | undefined): string {
  const parts = outfitParts(outfit);
  if (style !== undefined && !namesEveryGarment(outfit)) parts.push(`other garments in ${STYLE_PROMPT[style].label} style`);
  return `Outfit: ${parts.join('; ')}.`;
}

function clampDescription(words: string[]): string {
  const joined = words.join(', ');
  if (joined.length <= SUGGESTED_DESCRIPTION_MAX) return joined;
  const cut = joined.slice(0, SUGGESTED_DESCRIPTION_MAX);
  const boundary = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  return (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/[,\s]+$/, '');
}

export function buildIdentityPrompt(card: IdentityCard, scene: Scene): IdentityPrompt {
  const { style, outfit } = resolveStyleOutfit(card, scene);
  const lines: string[] = [REFERENCE_LINE];

  const identity = identityParts(card);
  if (identity.length > 0) lines.push(`Person: ${identity.join('; ')}.`);
  if (style !== undefined) lines.push(styleLine(style));
  if (outfit !== undefined) lines.push(outfitLine(outfit, style));
  if (style === undefined && outfit === undefined) lines.push(KEEP_OUTFIT_LINE);
  if (scene.pose !== undefined) lines.push(`Pose: ${scene.pose}.`);
  if (scene.setting !== undefined) lines.push(`Setting: ${scene.setting}.`);
  lines.push(`Lighting: ${LIGHTING_LABELS[scene.lighting]}.`);
  lines.push(
    scene.aspect === undefined
      ? `Framing: ${FRAMING_SHOTS[scene.framing]}.`
      : `Framing: ${FRAMING_SHOTS[scene.framing]}, ${scene.aspect} aspect ratio.`,
  );
  lines.push(card.version === 1 ? CLOSING_LINE_V1 : CLOSING_LINE_V2);

  const descriptionWords = [
    ...(outfit === undefined ? [] : outfitValues(outfit)),
    ...(scene.setting === undefined ? [] : [scene.setting]),
    `${LIGHTING_LABELS[scene.lighting]} lighting`,
    FRAMING_WORDS[scene.framing],
  ];

  return { prompt: lines.join('\n'), suggestedDescription: clampDescription(descriptionWords) };
}
