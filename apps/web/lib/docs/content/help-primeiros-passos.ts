import type { DocPage } from '../types';

export const helpFirstSteps: DocPage = {
  section: 'help',
  slug: 'primeiros-passos',
  title: { pt: 'Primeiros passos', en: 'First steps' },
  description: {
    pt: 'Crie sua persona, envie seu primeiro vídeo e publique nas suas contas.',
    en: 'Create your persona, upload your first video and publish to your accounts.',
  },
  updatedAt: '2026-11-26',
  contentHash: '7d88c1cbec0d8d76721ba7f7370d24f86a95f2b1aec0c6cdd80976eb4fb935d6',
  blocks: [
    {
      kind: 'paragraph',
      text: {
        pt: 'Tudo começa com uma persona: um nome, uma foto e as contas em que ela publica. A persona precisa de pelo menos uma conta de publicação ligada.',
        en: 'Everything starts with a persona: a name, a photo and the accounts it publishes to. A persona needs at least one publishing account linked.',
      },
    },
    { kind: 'heading', level: 2, text: { pt: 'Crie a persona', en: 'Create the persona' } },
    {
      kind: 'paragraph',
      text: {
        pt: 'Envie uma foto para a persona. Ela identifica a persona nas suas contas e nunca é publicada sozinha.',
        en: 'Upload a photo for the persona. It identifies the persona on your accounts and is never published on its own.',
      },
    },
    { kind: 'heading', level: 2, text: { pt: 'Envie o primeiro vídeo', en: 'Upload the first video' } },
    {
      kind: 'paragraph',
      text: {
        pt: 'Faça o vídeo na sua ferramenta e envie o arquivo pronto. Você escolhe publicar agora ou agendar para a data e a hora que quiser.',
        en: 'Make the video in your own tool and upload the finished file. You choose to publish it now or schedule it for the date and time you want.',
      },
    },
    { kind: 'heading', level: 2, text: { pt: 'Publique', en: 'Publish' } },
    {
      kind: 'paragraph',
      text: {
        pt: 'Escolha a data e a hora e o vídeo sai sozinho nas contas ligadas à persona. Você acompanha tudo em Publicações.',
        en: 'Pick the date and time and the video goes out on its own to the accounts linked to the persona. You follow everything in Posts.',
      },
    },
  ],
};
