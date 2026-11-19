export const houseVoice = (name: string, gender: 'female' | 'male') => ({
  id: `chatterbox:${name}`,
  label: null,
  provider: 'chatterbox',
  gender,
  accent: 'us',
  kind: 'standard',
  description: `American ${gender} voice.`,
});
