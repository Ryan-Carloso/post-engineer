// Generation facts for one slot: the read-only record of what the post
// was generated with.
//
// Extracted from route.ts so the route module stays under the file-size
// ratchet.
// buildGenerationFacts — the read-only record of what the post was
// generated with: the post_* snapshot columns written at creation
// (migration 012) plus the slot's faceless flag. A named function (not an
// inline object literal) so unit tests — and v8 coverage — see every leaf.
// The object keeps every key with null leaves (never undefined) so the UI
// never has to feature-detect; pre-012 schedules simply read all null.
// If a future migration drops or renames one of these columns, the select
// in getHandler is the thing that 500s.
//---------------
export function buildGenerationFacts(
  row: { faceless: boolean | null; faceless_material?: string | null },
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
  faceless: boolean;
  material: 'broll' | 'svg';
  language: string | null;
  voiceId: string | null;
  videoAspect: string | null;
  videoLayout: string | null;
  niche: string | null;
  paragraphNumber: number | null;
  faceQuality: string | null;
} {
  // Only the literal true counts — mirrors the engine's slot_faceless
  // rule, so a legacy NULL row is never misread as faceless.
  // One const per leaf (not an inline object literal): v8 coverage does not
  // report object-literal property lines, so this keeps every fact visible
  // to the coverage gate.
  const faceless = row.faceless === true;
  // Only the literal 'svg' counts — mirrors the engine's slot_material rule,
  // so a row predating migration 029 reads as the stock it rendered with.
  const material = row.faceless_material === 'svg' ? 'svg' : 'broll';
  const language = scheduleRow.post_language ?? null;
  const voiceId = scheduleRow.post_voice_id ?? null;
  const videoAspect = scheduleRow.post_video_aspect ?? null;
  // NULL for schedules created before migration 018. It is NOT normalized to
  // 'standard' here: this surface is a faithful read of the snapshot (like
  // every sibling above), and the engine is the single place that turns a
  // missing layout into a render decision.
  const videoLayout = scheduleRow.post_video_layout ?? null;
  const niche = scheduleRow.post_niche ?? null;
  const paragraphNumber = scheduleRow.post_paragraph_number ?? null;
  const faceQuality = scheduleRow.post_face_quality ?? null;
  return {
    faceless, material, language, voiceId, videoAspect, videoLayout, niche, paragraphNumber, faceQuality,
  };
}
