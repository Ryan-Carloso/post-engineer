//---------------
// persona-cta — per-persona call to action, intent only (issue #639).
// The persona stores the CTA type + facts (URL, or the "other"
// instruction); the agent writes the CTA words per video from the
// story and the topic. The old stored-text CTA (ctaText) is deleted
// with this change — beta rule: delete the old path, never keep both.
//
// The en/pt dictionaries are grandfathered over the 500-line file-size cap
// and may not grow a single line, so this feature's copy lives here. It is
// merged into the dictionaries in ./index.ts, which also extends the
// Dictionary/TranslationKey contract — en.ts and pt.ts stay the same size.
//---------------

export const personaCtaStrings = {
  en: {
    personas: {
      ctaSectionLabel: 'Call to action',
      ctaTypeLabel: 'CTA type',
      ctaTypeHint:
        'The persona stores only the intent. The agent writes the CTA words for each video, from the story and the topic.',
      ctaTypeFollow: 'Follow the account',
      ctaTypeComment: 'Comment',
      ctaTypeShare: 'Share',
      ctaTypeSave: 'Save the video',
      ctaTypeLink: 'Link in bio',
      ctaTypeBuy: 'Buy',
      ctaTypeOther: 'Other…',
      ctaOtherLabel: 'Custom instruction',
      ctaOtherPlaceholder: 'E.g. invite to the WhatsApp group',
      ctaUrlLabel: 'URL',
      ctaUrlPlaceholder: 'https://…',
      ctaUrlHint: 'Used only where the network allows a clickable link — see below.',
      ctaPreviewFollow: 'The agent ends the video asking viewers to follow this account.',
      ctaPreviewComment:
        'The agent writes 1 content take with a question from the video topic — never a stored question.',
      ctaPreviewShare: 'The agent asks viewers to share the video with someone it would help.',
      ctaPreviewSave: 'The agent asks viewers to save the video for later.',
      ctaPreviewLink: 'The agent points to the link where each network allows it — see the table below.',
      ctaPreviewBuy: 'The agent points to the purchase link where the network allows it.',
      ctaPreviewOther: 'The agent follows the custom instruction above, in its own words.',
      ctaLinkTableTitle: 'The “link” type does not work the same everywhere',
      ctaLinkTableNetwork: 'Network',
      ctaLinkTableClickable: 'Clickable link?',
      ctaLinkTableWhat: 'What the agent says / where the URL goes',
      ctaLinkYes: 'Yes',
      ctaLinkNo: 'No',
      ctaLinkYoutube:
        '“Link in the description” — the URL goes to the video description; it can also be pinned in a comment.',
      ctaLinkInstagram:
        'Caption links are not clickable. Spoken: “link in bio”. The bio holds exactly 1 link.',
      ctaLinkBluesky: 'The link in the post is clickable — the URL goes into the post text.',
      ctaLinkLinkedin: 'The link in the post is clickable — the URL goes into the post text.',
      ctaLinkThreads: 'The link in the post is clickable — the URL goes into the post text.',
      ctaLinkFacebook: 'The link in the post is clickable — the URL goes into the post text.',
      ctaLinkPinterest:
        'Links in the pin description are not clickable. Only the pin’s destination URL is clickable.',
      ctaLinkThreespeak:
        'The link in the post text is clickable — the Hive post body renders markdown links.',
      ctaLinkRumble: '“Link in the description” — the URL goes to the video description.',
      ctaLinkFanvue: 'The link in the post text is clickable — the URL goes into the post text.',
    },
  },
  pt: {
    personas: {
      ctaSectionLabel: 'Chamada pra ação',
      ctaTypeLabel: 'Tipo de CTA',
      ctaTypeHint:
        'A persona só guarda a intenção. O agente escreve as palavras do CTA em cada vídeo, a partir da história e do tema.',
      ctaTypeFollow: 'Seguir a conta',
      ctaTypeComment: 'Comentar',
      ctaTypeShare: 'Partilhar',
      ctaTypeSave: 'Guardar o vídeo',
      ctaTypeLink: 'Link na bio',
      ctaTypeBuy: 'Comprar',
      ctaTypeOther: 'Outro…',
      ctaOtherLabel: 'Instrução personalizada',
      ctaOtherPlaceholder: 'Ex.: convidar para o grupo de WhatsApp',
      ctaUrlLabel: 'URL',
      ctaUrlPlaceholder: 'https://…',
      ctaUrlHint: 'Usado só onde a rede permite link clicável — vê abaixo.',
      ctaPreviewFollow: 'O agente termina o vídeo a pedir para seguirem esta conta.',
      ctaPreviewComment:
        'O agente escreve 1 take de conteúdo com uma pergunta do tema do vídeo — nunca uma pergunta guardada.',
      ctaPreviewShare: 'O agente pede para partilharem o vídeo com alguém a quem ajudaria.',
      ctaPreviewSave: 'O agente pede para guardarem o vídeo para mais tarde.',
      ctaPreviewLink: 'O agente aponta para o link onde cada rede permite — vê a tabela abaixo.',
      ctaPreviewBuy: 'O agente aponta para o link de compra onde a rede permite.',
      ctaPreviewOther: 'O agente segue a instrução acima, com as suas palavras.',
      ctaLinkTableTitle: 'O tipo “link” não funciona igual em todo o lado',
      ctaLinkTableNetwork: 'Rede',
      ctaLinkTableClickable: 'Link clicável?',
      ctaLinkTableWhat: 'O que o agente diz / onde vai a URL',
      ctaLinkYes: 'Sim',
      ctaLinkNo: 'Não',
      ctaLinkYoutube:
        '“Link na descrição” — a URL vai para a descrição do vídeo; dá também para fixar num comentário.',
      ctaLinkInstagram: 'Link na legenda não é clicável. Falado: “link na bio”. A bio só tem 1 link.',
      ctaLinkBluesky: 'Link no post é clicável — a URL vai para o texto do post.',
      ctaLinkLinkedin: 'Link no post é clicável — a URL vai para o texto do post.',
      ctaLinkThreads: 'Link no post é clicável — a URL vai para o texto do post.',
      ctaLinkFacebook: 'Link no post é clicável — a URL vai para o texto do post.',
      ctaLinkPinterest:
        'Links na descrição do Pin não são clicáveis. Só o link de destino do Pin é clicável.',
      ctaLinkThreespeak: 'Link no texto do post é clicável — o corpo do post Hive mostra links markdown.',
      ctaLinkRumble: '“Link na descrição” — a URL vai para a descrição do vídeo.',
      ctaLinkFanvue: 'Link no texto do post é clicável — a URL vai para o texto do post.',
    },
  },
};
