//---------------
// longcat-fallback strings — the avatar-unavailable warning (LongCat →
// faceless fallback, Ryan's 2026-10 decision).
//
// The en/pt dictionaries are grandfathered over the 500-line file-size cap
// and may not grow a single line, so this feature's copy lives here. It is
// merged into the dictionaries in ./index.ts (same pattern as
// ./publishing-accounts), which also extends the Dictionary contract —
// en.ts and pt.ts stay byte-identical.
//---------------

export const longcatFallbackStrings = {
  en: {
    posts: {
      avatarDisabledWarning:
        'The avatar intro is temporarily unavailable (the generation engine\'s GPU partner is out of credits). This video was generated without the avatar.',
    },
  },
  pt: {
    posts: {
      avatarDisabledWarning:
        'O intro de avatar está temporariamente indisponível (o parceiro GPU do engine ficou sem créditos). Este vídeo foi gerado sem avatar.',
    },
  },
} as const;
