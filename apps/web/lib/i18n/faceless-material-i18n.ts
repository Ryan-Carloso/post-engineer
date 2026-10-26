//---------------
// faceless-material — the faceless video's material choice.
//
// The en/pt dictionaries are grandfathered over the 500-line file-size cap
// and may not grow a single line, so this feature's copy lives here. It is
// merged into the dictionaries in ./index.ts, which also extends the
// Dictionary/TranslationKey contract — en.ts and pt.ts stay the same size.
//---------------

export const facelessMaterialStrings = {
  en: {
    newPost: {
      faceMaterialLabel: 'Faceless material',
      faceMaterialHint: 'What fills a video without a face. Only shown for faceless videos.',
      faceMaterialBroll: 'B-roll (stock)',
      faceMaterialBrollHint:
        'Stock footage first. A clip that fails verification still falls back to an illustration.',
      faceMaterialSvg: 'SVG (illustration)',
      faceMaterialSvgHint: 'Drawn illustrations from the catalog only. No stock footage at all.',
    },
  },
  pt: {
    newPost: {
      faceMaterialLabel: 'Material faceless',
      faceMaterialHint: 'O que preenche um vídeo sem rosto. Só aparece em vídeos faceless.',
      faceMaterialBroll: 'B-roll (estoque)',
      faceMaterialBrollHint:
        'Stock footage primeiro. Um clip que falhar na verificação ainda cai para uma ilustração.',
      faceMaterialSvg: 'SVG (ilustração)',
      faceMaterialSvgHint: 'Só ilustrações desenhadas do catálogo. Nenhum stock footage.',
    },
  },
};
