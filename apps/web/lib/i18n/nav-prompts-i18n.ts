// nav-prompts-i18n — copy for the recipes nav tab (API key and MCP),
// the History nav entry and the mobile "More" sheet.
// Merged into nav in ./index.ts, following the metrics-i18n pattern:
// en.ts/pt.ts are grandfathered over the 500-line file-size cap and may
// not grow, so new nav copy lives here instead of in those files.
export const promptsStrings = {
  pt: {
    nav: {
      prompts: 'Chave de API e MCP',
      // Short label for the mobile bottom tab: the full label wraps to two
      // lines in a ~70px tab. The sidebar and the "More" sheet keep the
      // full label.
      promptsShort: 'Chave',
      promptsHint: 'Chave de API, configuração e prompts para o seu agente',
      history: 'Histórico',
      historyHint: 'Posts passados e gerações',
      more: 'Mais',
      moreTitle: 'Mais opções',
    },
  },
  en: {
    nav: {
      prompts: 'API key and MCP',
      promptsShort: 'API key',
      promptsHint: 'API key, setup, and prompts for your agent',
      history: 'History',
      historyHint: 'Past posts and generations',
      more: 'More',
      moreTitle: 'More options',
    },
  },
} as const;
