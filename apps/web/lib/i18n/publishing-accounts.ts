//---------------
// publishing-accounts — per-persona default publishing accounts (issue #212).
//
// The en/pt dictionaries are grandfathered over the 500-line file-size cap
// and may not grow a single line, so this feature's copy lives here. It is
// merged into the dictionaries in ./index.ts, which also extends the
// Dictionary/TranslationKey contract — en.ts and pt.ts stay byte-identical.
//---------------

export const publishingAccountsStrings = {
  en: {
    apiKeys: {
      toolDescGetPersonaPublishingAccounts: 'List a persona\u2019s default publishing accounts',
      toolDescSetPersonaPublishingAccounts: 'Set a persona\u2019s default publishing accounts',
    },
    persona: {
      publishingAccountsLabel: 'Default publishing accounts',
      publishingAccountsHint:
        'When a video is generated without choosing accounts, it publishes to these defaults. An explicit account choice always wins.',
      publishingAccountsSave: 'Save defaults',
      publishingAccountsSaving: 'Saving…',
      publishingAccountsSaved: 'Defaults saved.',
      publishingAccountsLoadError: 'Could not load the default accounts.',
      publishingAccountsSaveError: 'Could not save the default accounts.',
      publishingAccountsNoAccounts: 'No {provider} accounts connected.',
      connectAccounts: 'Connect accounts',
    },
  },
  pt: {
    apiKeys: {
      toolDescGetPersonaPublishingAccounts: 'Liste as contas de publicação padrão da persona',
      toolDescSetPersonaPublishingAccounts: 'Defina as contas de publicação padrão da persona',
    },
    persona: {
      publishingAccountsLabel: 'Contas padrão de publicação',
      publishingAccountsHint:
        'Quando um vídeo é gerado sem escolher contas, ele publica nestes padrões. Uma escolha explícita de conta sempre prevalece.',
      publishingAccountsSave: 'Salvar padrões',
      publishingAccountsSaving: 'Salvando…',
      publishingAccountsSaved: 'Padrões salvos.',
      publishingAccountsLoadError: 'Não foi possível carregar as contas padrão.',
      publishingAccountsSaveError: 'Não foi possível salvar as contas padrão.',
      publishingAccountsNoAccounts: 'Nenhuma conta de {provider} conectada.',
      connectAccounts: 'Conectar contas',
    },
  },
} as const;
