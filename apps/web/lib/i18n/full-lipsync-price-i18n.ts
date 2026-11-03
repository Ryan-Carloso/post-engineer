//---------------
// full-lipsync-price — the full lip-sync cost line on the persona screen.
// The en/pt dictionaries are grandfathered over the 500-line file-size cap
// and may not grow a single line, so this feature's copy lives here. It is
// merged into the dictionaries in ./index.ts, which also extends the
// Dictionary/TranslationKey contract — en.ts and pt.ts stay the same size.
//---------------

export const fullLipsyncPriceStrings = {
  en: {
    tokens: {
      fullLipsyncCostLabel: 'Full lip-sync cost per video',
    },
  },
  pt: {
    tokens: {
      fullLipsyncCostLabel: 'Custo por vídeo em full lip-sync',
    },
  },
};
