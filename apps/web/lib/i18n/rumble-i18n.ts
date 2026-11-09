//---------------
// rumble-i18n — copy of the Rumble section on the accounts screen.
//
// The en/pt dictionaries are grandfathered over the 500-line file-size cap
// and may not grow a single line, so this feature's copy lives here and is
// merged in ./index.ts (same pattern as ./facebook-i18n).
//---------------

export const rumbleStrings = {
  en: {
    accounts: {
      rumbleLabel: 'Rumble',
      rumbleDescription: 'Publish videos to your Rumble channel with a manually issued access token.',
      rumbleConnectTitle: 'Connect Rumble',
      rumbleConnectHint:
        'Rumble has no OAuth: request the 40-character access token by emailing bd@rumble.com, then paste it here with your channel ID. The token is stored encrypted and never shown again.',
      rumbleChannelLabel: 'Channel ID',
      rumbleTokenLabel: 'Access token',
      rumbleConnect: 'Connect Rumble',
      rumbleSecurityHint:
        'The access token is like a password for your Rumble account: anyone with it can upload as you. Keep it private — if it leaks, email Rumble to revoke it.',
      rumbleConnectError: 'Could not connect Rumble. Check the channel ID and the 40-character access token.',
    },
  },
  pt: {
    accounts: {
      rumbleLabel: 'Rumble',
      rumbleDescription: 'Publique vídeos no seu canal do Rumble com um token de acesso emitido manualmente.',
      rumbleConnectTitle: 'Conectar Rumble',
      rumbleConnectHint:
        'O Rumble não tem OAuth: peça o token de acesso de 40 caracteres por email para bd@rumble.com e cole aqui com o ID do canal. O token fica guardado encriptado e nunca é mostrado novamente.',
      rumbleChannelLabel: 'ID do canal',
      rumbleTokenLabel: 'Token de acesso',
      rumbleConnect: 'Conectar Rumble',
      rumbleSecurityHint:
        'O token de acesso é como uma senha da sua conta Rumble: quem o tiver pode publicar como você. Mantenha-o privado — se vazar, envie um email ao Rumble para revogá-lo.',
      rumbleConnectError: 'Não foi possível conectar o Rumble. Verifique o ID do canal e o token de acesso de 40 caracteres.',
    },
  },
};
