//---------------
// publishing-accounts — per-persona bound publishing accounts (issue #212;
// the binding became mandatory in issue #572: a persona publishes ONLY to
// these accounts, at least one is required).
//
// The en/pt dictionaries are grandfathered over the 500-line file-size cap
// and may not grow a single line, so this feature's copy lives here. It is
// merged into the dictionaries in ./index.ts, which also extends the
// Dictionary/TranslationKey contract — en.ts and pt.ts stay byte-identical.
//---------------

export const publishingAccountsStrings = {
  en: {
    apiKeys: {
      toolDescGetPersonaPublishingAccounts: 'List a persona\u2019s bound publishing accounts',
      toolDescSetPersonaPublishingAccounts: 'Set a persona\u2019s bound publishing accounts',
    },
    persona: {
      publishingAccountsLabel: 'Publishing accounts',
      publishingAccountsHint:
        'This persona publishes only to these accounts — at least one is required. When a video is generated without choosing accounts, it publishes to all of them.',
      publishingAccountsSave: 'Save accounts',
      publishingAccountsSaving: 'Saving…',
      publishingAccountsSaved: 'Accounts saved.',
      publishingAccountsLoadError: 'Could not load the publishing accounts.',
      publishingAccountsSaveError: 'Could not save the publishing accounts.',
      publishingAccountsNoAccounts: 'No {provider} accounts connected.',
      connectAccounts: 'Connect accounts',
    },
  },
  pt: {
    apiKeys: {
      toolDescGetPersonaPublishingAccounts: 'Liste as contas de publicação vinculadas da persona',
      toolDescSetPersonaPublishingAccounts: 'Defina as contas de publicação vinculadas da persona',
    },
    persona: {
      publishingAccountsLabel: 'Contas de publicação',
      publishingAccountsHint:
        'Esta persona publica apenas nestas contas — pelo menos uma é obrigatória. Quando um vídeo é gerado sem escolher contas, ele publica em todas elas.',
      publishingAccountsSave: 'Salvar contas',
      publishingAccountsSaving: 'Salvando…',
      publishingAccountsSaved: 'Contas salvas.',
      publishingAccountsLoadError: 'Não foi possível carregar as contas de publicação.',
      publishingAccountsSaveError: 'Não foi possível salvar as contas de publicação.',
      publishingAccountsNoAccounts: 'Nenhuma conta de {provider} conectada.',
      connectAccounts: 'Conectar contas',
    },
  },
} as const;
