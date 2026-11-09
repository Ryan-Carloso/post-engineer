// Schedule detail for one slot: the schedule row's account lists,
// board and publish mode, as the post-detail response renders them.
//
// Extracted from post-detail.ts so the module stays under the
// file-size ratchet. One const per leaf (not an inline object
// literal): v8 coverage does not report object-literal property
// lines, so this keeps every leaf visible to the coverage gate.

export interface ScheduleDetailRow {
    id: string;
    persona_id: string | null;
    providers: string[] | null;
    youtube_account_ids: string[] | null;
    instagram_account_ids: string[] | null;
    linkedin_account_ids: string[] | null;
    bluesky_account_ids: string[] | null;
    threads_account_ids: string[] | null;
    facebook_account_ids: string[] | null;
    pinterest_account_ids: string[] | null;
    pinterest_board_id: string | null;
    threespeak_account_ids: string[] | null;
    timezone: string;
    post_language: string | null;
    post_voice_id: string | null;
    post_video_aspect: string | null;
    post_video_layout: string | null;
    post_niche: string | null;
    post_paragraph_number: number | null;
    post_face_quality: string | null;
    publish_mode: string | null;
}

export function buildScheduleDetail(scheduleRow: ScheduleDetailRow) {
  const scheduleId2 = scheduleRow.id;
  const personaIdOut = scheduleRow.persona_id;
  const providersOut = scheduleRow.providers ?? [];
  const youtubeAccountIdsOut = scheduleRow.youtube_account_ids ?? [];
  const instagramAccountIdsOut = scheduleRow.instagram_account_ids ?? [];
  const linkedinAccountIdsOut = scheduleRow.linkedin_account_ids ?? [];
  const blueskyAccountIdsOut = scheduleRow.bluesky_account_ids ?? [];
  const threadsAccountIdsOut = scheduleRow.threads_account_ids ?? [];
  const facebookAccountIdsOut = scheduleRow.facebook_account_ids ?? [];
  const pinterestAccountIdsOut = scheduleRow.pinterest_account_ids ?? [];
  const pinterestBoardIdOut = scheduleRow.pinterest_board_id ?? null;
  const threespeakAccountIdsOut = scheduleRow.threespeak_account_ids ?? [];
  const timezoneOut = scheduleRow.timezone;
  const publishModeOut: 'asap' | 'scheduled' = scheduleRow.publish_mode === 'asap' ? 'asap' : 'scheduled';
  return {
    id: scheduleId2,
    personaId: personaIdOut,
    providers: providersOut,
    youtubeAccountIds: youtubeAccountIdsOut,
    instagramAccountIds: instagramAccountIdsOut,
    linkedinAccountIds: linkedinAccountIdsOut,
    blueskyAccountIds: blueskyAccountIdsOut,
    threadsAccountIds: threadsAccountIdsOut,
    facebookAccountIds: facebookAccountIdsOut,
    pinterestAccountIds: pinterestAccountIdsOut,
    pinterestBoardId: pinterestBoardIdOut,
    threespeakAccountIds: threespeakAccountIdsOut,
    timezone: timezoneOut,
    publishMode: publishModeOut,
  };
}
