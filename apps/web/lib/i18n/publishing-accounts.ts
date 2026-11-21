export const publishingAccountsStrings = {
  en: {
    persona: {
      publishingAccountsLabel: 'Publishing accounts',
      publishingAccountsHint:
        'This persona publishes only to these accounts — at least one is required. When a video is generated without choosing accounts, it publishes to all of them.',
      publishingAccountsLoadError: 'Could not load the publishing accounts.',
      publishingAccountsSaveError: 'Could not save the publishing accounts.',
      publishingAccountsNoAccounts: 'No {provider} accounts connected.',
      connectAccounts: 'Connect accounts',
    },
  },
  pt: {
    persona: {
      publishingAccountsLabel: 'Contas de publicação',
      publishingAccountsHint:
        'Esta persona publica apenas nestas contas — pelo menos uma é obrigatória. Quando um vídeo é gerado sem escolher contas, ele publica em todas elas.',
      publishingAccountsLoadError: 'Não foi possível carregar as contas de publicação.',
      publishingAccountsSaveError: 'Não foi possível salvar as contas de publicação.',
      publishingAccountsNoAccounts: 'Nenhuma conta de {provider} conectada.',
      connectAccounts: 'Conectar contas',
    },
  },
} as const;
