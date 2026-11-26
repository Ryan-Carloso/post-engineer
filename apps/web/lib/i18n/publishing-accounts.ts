export const publishingAccountsStrings = {
  en: {
    persona: {
      publishingAccountsLabel: 'Publishing accounts',
      publishingAccountsHint:
        'This persona publishes only to these accounts — at least one is required. When a post is published without choosing accounts, it goes to these accounts.',
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
        'Esta persona publica apenas nestas contas — pelo menos uma é obrigatória. Quando um post é publicado sem escolher contas, ele vai para estas contas.',
      publishingAccountsLoadError: 'Não foi possível carregar as contas de publicação.',
      publishingAccountsSaveError: 'Não foi possível salvar as contas de publicação.',
      publishingAccountsNoAccounts: 'Nenhuma conta de {provider} conectada.',
      connectAccounts: 'Conectar contas',
    },
  },
} as const;
