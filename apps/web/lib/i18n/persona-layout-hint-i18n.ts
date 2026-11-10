//---------------
// persona-layout-hint — the one copy line that names what the bottom half
// of a video shows. Every video is the agent's own images since migration
// 054 (the material choice died with stock B-roll and SVG), so the hint
// names the images, not a choice.
//
// The en/pt dictionaries are grandfathered over the 500-line file-size cap
// and may not grow a single line, so this feature's copy lives here. It is
// merged into the dictionaries in ./index.ts, which also extends the
// Dictionary/TranslationKey contract — en.ts and pt.ts stay the same size.
//---------------

export const personaLayoutHintStrings = {
  en: {
    personas: {
      layoutHint: "The bottom half shows the agent's own images for each post.",
    },
  },
  pt: {
    personas: {
      layoutHint: 'Na metade de baixo entram as imagens do agente em cada post.',
    },
  },
};
