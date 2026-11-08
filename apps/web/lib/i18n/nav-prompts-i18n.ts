// nav-prompts-i18n — copy for the "API Key & MCP" nav tab (the /recipes
// hub), the History nav entry and the mobile "More" sheet.
// Merged into nav in ./index.ts, following the metrics-i18n pattern:
// en.ts/pt.ts are grandfathered over the 500-line file-size cap and may
// not grow, so new nav copy lives here instead of in those files.
export const promptsStrings = {
  pt: {
    nav: {
      prompts: 'API Key e MCP',
      promptsHint: 'API key, setup e prompts para o seu agente',
      history: 'Histórico',
      historyHint: 'Posts passados e gerações',
      more: 'Mais',
      moreTitle: 'Mais opções',
    },
  },
  en: {
    nav: {
      prompts: 'API Key & MCP',
      promptsHint: 'API key, setup, and prompts for your agent',
      history: 'History',
      historyHint: 'Past posts and generations',
      more: 'More',
      moreTitle: 'More options',
    },
  },
} as const;
