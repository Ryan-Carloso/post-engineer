//---------------
// House voice fixture as GET /api/persona/voices returns it
// (lib/voice-catalog.ts VoiceOption). label null: the picker shows the id
// without the `chatterbox:` prefix ("en us male 01").
//---------------
export const houseVoice = (name: string, gender: 'female' | 'male') => ({
  id: `chatterbox:${name}`,
  label: null,
  provider: 'chatterbox',
  gender,
  accent: 'us',
  kind: 'standard',
  description: `American ${gender} voice.`,
});
