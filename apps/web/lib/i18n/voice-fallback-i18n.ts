//---------------
// voice-fallback strings — invalid-persona-voice swap warning (issue #277).
//
// The en/pt dictionaries are grandfathered over the 500-line file-size cap
// and may not grow a single line, so this feature's copy lives here. It is
// merged into the dictionaries in ./index.ts, which also extends the
// Dictionary/TranslationKey contract — en.ts and pt.ts stay byte-identical.
//---------------

export const voiceFallbackStrings = {
  en: {
    newPost: {
      voiceFallbackWarning:
        'The voice {fromVoice} is no longer available; we switched to {toVoice}. You can change it in Persona → Voice.',
      voiceFallbackMissingWarning:
        'This persona had no usable voice configured; we switched to {toVoice}. You can change it in Persona → Voice.',
      errorVoiceUnavailable:
        'This persona’s voice is unavailable and there is no default voice for its language. Update the persona.',
    },
    persona: {
      voiceFallbackWarning:
        'The voice {fromVoice} is no longer available; new videos will use {toVoice}. You can change it in Persona → Voice.',
      voiceFallbackMissingWarning:
        'No usable voice is configured; new videos would use {toVoice}. You can change it in Persona → Voice.',
    },
  },
  pt: {
    newPost: {
      voiceFallbackWarning:
        'A voz {fromVoice} deixou de estar disponível; trocámos para {toVoice}. Podes mudar em Persona → Voz.',
      voiceFallbackMissingWarning:
        'Esta persona não tinha voz configurada; trocámos para {toVoice}. Podes mudar em Persona → Voz.',
      errorVoiceUnavailable:
        'A voz desta persona não está disponível e não há voz padrão para o idioma. Atualize a persona.',
    },
    persona: {
      voiceFallbackWarning:
        'A voz {fromVoice} deixou de estar disponível; novos vídeos usarão {toVoice}. Podes mudar em Persona → Voz.',
      voiceFallbackMissingWarning:
        'Não há voz configurada; novos vídeos usarão {toVoice}. Podes mudar em Persona → Voz.',
    },
  },
} as const;
