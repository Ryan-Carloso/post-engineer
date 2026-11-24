export function buildGenerationFacts(
  row: { voiceover: boolean | null },
  scheduleRow: {
    post_language: string | null;
    post_voice_id: string | null;
    post_video_aspect: string | null;
    post_video_layout: string | null;
    post_niche: string | null;
    post_paragraph_number: number | null;
    post_face_quality: string | null;
  },
): {
  voiceover: boolean;
  language: string | null;
  voiceId: string | null;
  videoAspect: string | null;
  videoLayout: string | null;
  niche: string | null;
  paragraphNumber: number | null;
  faceQuality: string | null;
} {
  const voiceover = row.voiceover === true;
  const language = scheduleRow.post_language ?? null;
  const voiceId = scheduleRow.post_voice_id ?? null;
  const videoAspect = scheduleRow.post_video_aspect ?? null;
  const videoLayout = scheduleRow.post_video_layout ?? null;
  const niche = scheduleRow.post_niche ?? null;
  const paragraphNumber = scheduleRow.post_paragraph_number ?? null;
  const faceQuality = scheduleRow.post_face_quality ?? null;
  return {
    voiceover, language, voiceId, videoAspect, videoLayout, niche, paragraphNumber, faceQuality,
  };
}
