export const personaVoiceCloneEn = {
  voiceHouseTab: 'House voices',
  voiceCloneTab: 'Clone my voice',
  voiceCloneHint:
    'Record or upload a short sample of your voice. It is used only to create a TTS clone on your account.',
  voiceCloneScript:
    'Read aloud in a natural tone: "Hello! This is a test of my cloned voice. I am speaking clearly and steadily so the system can learn my tone. I will keep going for a few more seconds, without rushing or whispering."',
  voiceCloneConsent:
    'I consent to using this recording solely to create and use a voice clone on my account.',
  voiceCloneConsentRequired: 'Check the consent box before submitting.',
  voiceCloneRecord: 'Record in browser',
  voiceCloneStop: 'Stop recording',
  voiceCloneUpload: 'Upload file',
  voiceCloneDurationGuide: 'Aim for {soft}s of continuous speech (min {min}s, max {max}s).',
  voiceCloneLocalPreview: 'Listen before submitting',
  voiceCloneRerecord: 'Record again',
  voiceCloneSubmit: 'Create voice clone',
  voiceCloneSubmitting: 'Submitting…',
  voiceClonePending: 'Processing your voice clone…',
  voiceCloneFailed: 'Could not create the clone. Try another recording.',
  voiceCloneListError: 'Could not load your clones.',
  voiceCloneMicUnavailable: 'Recording is not available in this browser.',
  voiceCloneMicDenied: 'Allow microphone access to record.',
  voiceCloneNeedAudio: 'Record or upload audio before submitting.',
  voiceClonePreviewFailed: 'Could not play the preview.',
  voiceClonePlayPreview: 'Play preview',
  voiceCloneUseOnPersona: 'Use on this persona',
  voiceCloneDelete: 'Delete clone',
  voiceCloneStatusReady: 'Ready',
  voiceCloneStatusPending: 'Processing',
  voiceCloneStatusFailed: 'Failed',
} as const;

export const voiceCloneApiToolDescEn = {
  toolDescListClonedVoices: 'List your voice clones',
  toolDescCreateClonedVoice: 'Create a voice clone from an audio URL',
  toolDescDeleteClonedVoice: 'Delete a voice clone',
  toolDescPreviewClonedVoice: 'Preview a ready voice clone',
} as const;
