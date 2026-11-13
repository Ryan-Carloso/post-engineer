//---------------
// persona-bound-accounts — the persona card copy for issue #572: the
// bound publishing accounts shown on each card, and the warning when a
// persona binds none.
//
// The en/pt dictionaries are grandfathered over the 500-line file-size cap
// and may not grow a single line, so this feature's copy lives here. It is
// merged into the dictionaries in ./index.ts, which also extends the
// Dictionary/TranslationKey contract — en.ts and pt.ts stay the same size.
//---------------

export const personaBoundAccountsStrings = {
  en: {
    personas: {
      boundAccountsLabel: 'Publishes to',
      noBoundAccounts: 'No accounts bound — tap to bind one',
    },
  },
  pt: {
    personas: {
      boundAccountsLabel: 'Publica em',
      noBoundAccounts: 'Nenhuma conta ligada — toca para ligar uma',
    },
  },
};
