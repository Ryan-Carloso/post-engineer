//---------------
// telegram-i18n — copy of the Telegram section on the accounts screen,
// including the channel/group setup guide (the "info" that walks the
// user through @BotFather, adding the bot and granting it permission).
//
// The en/pt dictionaries are grandfathered over the 500-line file-size
// cap and may not grow a single line, so this feature's copy lives here
// and is merged in ./index.ts (same pattern as ./rumble-i18n).
//---------------

export const telegramStrings = {
  en: {
    accounts: {
      telegramLabel: 'Telegram',
      telegramDescription: 'Publish videos, photos and audio to your Telegram channels and groups with your own bot.',
      telegramConnectTitle: 'Connect Telegram',
      telegramConnectHint:
        'Telegram has no OAuth: you publish through a bot you create with @BotFather. The bot token is stored encrypted and never shown again.',
      telegramTokenLabel: 'Bot token (from @BotFather)',
      telegramChatLabel: 'Chat ID or @username',
      telegramConnect: 'Connect Telegram',
      telegramKindChannel: 'Channel',
      telegramKindGroup: 'Group',
      telegramSetupTitle: 'How to set it up',
      telegramSetupBotFather: 'Open @BotFather in Telegram, send /newbot and follow the steps. Copy the token it gives you.',
      telegramSetupAddChannel: 'Open your channel, add the bot as an administrator and grant it permission to post messages.',
      telegramSetupAddGroup: 'Open your group, add the bot as a member. If the group only lets admins send messages, promote the bot to administrator.',
      telegramSetupChatId: 'Paste the public @username of the chat, or its numeric chat ID (channels and supergroups start with -100). Tip: add @RawDataBot to the chat to see its ID.',
      telegramSecurityHint:
        'The bot token is like a password: anyone with it can post as your bot. Keep it private — if it leaks, revoke it with /revoke in @BotFather.',
      telegramConnectError: 'Could not connect Telegram. Check the bot token, the chat and that the bot can post there.',
      telegramErrorToken: 'Telegram rejected the bot token. Copy a fresh token from @BotFather and try again.',
      telegramErrorChatNotFound: 'Telegram could not find that chat. Check the chat ID or @username, and that the bot was added to it.',
      telegramErrorIsGroup: 'That chat is a group, not a channel. Pick Group above and try again.',
      telegramErrorIsChannel: 'That chat is a channel, not a group. Pick Channel above and try again.',
      telegramErrorNotMember: 'The bot is not in that chat yet. Add it in Telegram first, then try again.',
      telegramErrorCannotPost: 'The bot cannot post there yet. Make it an administrator who can post (channel) or let it send messages (group).',
      telegramChannelBadge: 'Channel',
      telegramGroupBadge: 'Group',
    },
  },
  pt: {
    accounts: {
      telegramLabel: 'Telegram',
      telegramDescription: 'Publique vídeos, fotos e áudio nos seus canais e grupos do Telegram com o seu próprio bot.',
      telegramConnectTitle: 'Conectar Telegram',
      telegramConnectHint:
        'O Telegram não tem OAuth: você publica através de um bot que cria no @BotFather. O token do bot fica guardado encriptado e nunca é mostrado novamente.',
      telegramTokenLabel: 'Token do bot (do @BotFather)',
      telegramChatLabel: 'ID do chat ou @usuário',
      telegramConnect: 'Conectar Telegram',
      telegramKindChannel: 'Canal',
      telegramKindGroup: 'Grupo',
      telegramSetupTitle: 'Como configurar',
      telegramSetupBotFather: 'Abra o @BotFather no Telegram, envie /newbot e siga os passos. Copie o token que ele enviar.',
      telegramSetupAddChannel: 'Abra o seu canal, adicione o bot como administrador e dê a ele permissão para publicar mensagens.',
      telegramSetupAddGroup: 'Abra o seu grupo e adicione o bot como membro. Se o grupo só deixar administradores enviar mensagens, promova o bot a administrador.',
      telegramSetupChatId: 'Cole o @usuário público do chat, ou o ID numérico dele (canais e supergrupos começam com -100). Dica: adicione o @RawDataBot ao chat para ver o ID.',
      telegramSecurityHint:
        'O token do bot é como uma senha: quem o tiver pode publicar como o seu bot. Mantenha-o privado — se vazar, revogue-o com /revoke no @BotFather.',
      telegramConnectError: 'Não foi possível conectar o Telegram. Verifique o token do bot, o chat e se o bot pode publicar lá.',
      telegramErrorToken: 'O Telegram recusou o token do bot. Copie um token novo no @BotFather e tente de novo.',
      telegramErrorChatNotFound: 'O Telegram não encontrou esse chat. Confira o ID ou o @usuário, e se o bot foi adicionado a ele.',
      telegramErrorIsGroup: 'Esse chat é um grupo, não um canal. Escolha Grupo acima e tente de novo.',
      telegramErrorIsChannel: 'Esse chat é um canal, não um grupo. Escolha Canal acima e tente de novo.',
      telegramErrorNotMember: 'O bot ainda não está nesse chat. Adicione-o no Telegram primeiro e tente de novo.',
      telegramErrorCannotPost: 'O bot ainda não pode publicar lá. Torne-o administrador com permissão de publicar (canal) ou deixe-o enviar mensagens (grupo).',
      telegramChannelBadge: 'Canal',
      telegramGroupBadge: 'Grupo',
    },
  },
};
