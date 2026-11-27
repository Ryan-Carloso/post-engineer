export const CARD_STYLES = [
  'casual',
  'business',
  'business_casual',
  'formal',
  'elegant',
  'romantic',
  'sensual',
  'sporty',
  'athleisure',
  'streetwear',
  'boho',
  'minimalist',
  'vintage',
  'glamorous',
  'edgy',
  'cozy',
  'beach',
  'party',
  'outdoor',
] as const;

export type CardStyle = (typeof CARD_STYLES)[number];

interface StylePrompt {
  label: string;
  description: string;
}

export const STYLE_PROMPT: Record<CardStyle, StylePrompt> = {
  casual: { label: 'casual', description: 'relaxed everyday clothes' },
  business: { label: 'business', description: 'tailored suit, formal office wear' },
  business_casual: { label: 'business casual', description: 'smart shirt and trousers, no tie' },
  formal: { label: 'formal', description: 'formal evening wear' },
  elegant: { label: 'elegant', description: 'refined, understated, timeless' },
  romantic: { label: 'romantic', description: 'soft, graceful, flowing' },
  sensual: { label: 'sensual', description: 'fitted, elegant, confident, fully covered' },
  sporty: { label: 'sporty', description: 'athletic wear' },
  athleisure: { label: 'athleisure', description: 'gym-ready, comfortable athletic wear' },
  streetwear: { label: 'streetwear', description: 'urban, casual street clothes' },
  boho: { label: 'boho', description: 'loose, earthy, layered' },
  minimalist: { label: 'minimalist', description: 'simple, clean lines, neutral' },
  vintage: { label: 'vintage', description: 'retro-inspired, classic cuts' },
  glamorous: { label: 'glamorous', description: 'polished evening gown or tailored suit' },
  edgy: { label: 'edgy', description: 'bold, dark, statement pieces' },
  cozy: { label: 'cozy', description: 'soft knits, warm layers' },
  beach: { label: 'beachwear', description: 'linen shirt, sundress, covered resort wear' },
  party: { label: 'party', description: 'festive cocktail outfit' },
  outdoor: { label: 'outdoor', description: 'practical outdoor layers, weather-ready' },
};
