//---------------
// faceless-material — the video's material choice (stock or drawings),
// offered for every post, with or without a face.
//
// The en/pt dictionaries are grandfathered over the 500-line file-size cap
// and may not grow a single line, so this feature's copy lives here. It is
// merged into the dictionaries in ./index.ts, which also extends the
// Dictionary/TranslationKey contract — en.ts and pt.ts stay the same size.
//---------------

export const facelessMaterialStrings = {
  en: {
    newPost: {
      faceMaterialLabel: 'Video material',
      faceMaterialHint: 'What shows on screen during the video. The two never mix.',
      faceMaterialBroll: 'Real video clips',
      faceMaterialBrollHint:
        'Only real filmed clips from a free video library (people, places, objects).',
      faceMaterialSvg: 'Drawings (illustrations)',
      faceMaterialSvgHint: 'Only flat drawings from our illustration catalog. No real filmed footage.',
    },
  },
  pt: {
    newPost: {
      faceMaterialLabel: 'Material do vídeo',
      faceMaterialHint: 'O que aparece na tela durante o vídeo. Os dois nunca se misturam.',
      faceMaterialBroll: 'Vídeos reais',
      faceMaterialBrollHint:
        'Só trechos filmados de verdade, de um banco de vídeos gratuito (pessoas, lugares, objetos).',
      faceMaterialSvg: 'Desenhos (ilustrações)',
      faceMaterialSvgHint: 'Só desenhos simples do nosso catálogo de ilustrações. Nenhuma filmagem real.',
    },
  },
};
