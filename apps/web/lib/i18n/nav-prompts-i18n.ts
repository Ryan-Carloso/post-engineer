// nav-prompts-i18n — copy for the Prompts nav tab (the /recipes hub).
// Merged into nav in ./index.ts, following the metrics-i18n pattern:
// en.ts/pt.ts are grandfathered over the 500-line file-size cap and may
// not grow, so new nav copy lives here instead of in those files.
export const promptsStrings = {
  pt: {
    nav: {
      prompts: 'Pegue seus prompts',
      promptsHint: 'Prompts prontos para o seu agente',
    },
  },
  en: {
    nav: {
      prompts: 'Get your prompts',
      promptsHint: 'Ready-made prompts for your agent',
    },
  },
} as const;
