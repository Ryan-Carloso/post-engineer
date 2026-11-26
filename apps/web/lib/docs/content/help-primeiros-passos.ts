import type { DocPage } from '../types';

export const helpFirstSteps: DocPage = {
  section: 'help',
  slug: 'primeiros-passos',
  title: { pt: 'Primeiros passos', en: 'First steps' },
  description: {
    pt: 'Crie sua persona, gere seu primeiro vídeo e publique nas suas contas.',
    en: 'Create your persona, generate your first video and publish to your accounts.',
  },
  updatedAt: '2026-11-26',
  contentHash: '810551b74db0b60d4e17faf83d4b8d60d6d0be7de6fbe48161c7c7c62d462de6',
  blocks: [
    {
      kind: 'paragraph',
      text: {
        pt: 'Tudo começa com uma persona: um rosto, uma voz e um nicho. A persona precisa de pelo menos uma conta de publicação ligada.',
        en: 'Everything starts with a persona: a face, a voice and a niche. A persona needs at least one publishing account linked.',
      },
    },
    { kind: 'heading', level: 2, text: { pt: 'Crie a persona', en: 'Create the persona' } },
    {
      kind: 'paragraph',
      text: {
        pt: 'Envie uma foto de rosto e escolha uma voz. A foto fica guardada como referência e nunca aparece nos vídeos: cada vídeo usa as fotos que você envia para ele.',
        en: 'Upload a face photo and pick a voice. The photo is stored as a reference and never appears in videos: each video uses the photos you send for it.',
      },
    },
    { kind: 'heading', level: 2, text: { pt: 'Gere o primeiro vídeo', en: 'Generate the first video' } },
    {
      kind: 'paragraph',
      text: {
        pt: 'Escreva o roteiro como takes: o hook primeiro, depois os takes de conteúdo. A geração já está ligada à publicação, então todo vídeo nasce agendado.',
        en: 'Write the script as takes: the hook first, then the content takes. Generation is already tied to publishing, so every video is born scheduled.',
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
