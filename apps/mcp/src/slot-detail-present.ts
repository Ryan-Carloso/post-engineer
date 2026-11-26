import type { ResponseOf } from './contracts/endpoint.js';
import type { getSlot as getSlotContract } from './contracts/schedule.js';

export function presentSlotDetail(detail: ResponseOf<typeof getSlotContract>) {
  const { slot, schedule, persona } = detail;
  return {
    slot: {
      id: slot.id,
      scheduleId: slot.scheduleId,
      slotAt: slot.slotAt,
      status: slot.status,
      title: slot.title,
      taskId: slot.taskId,
      progress: slot.progress,
      stage: slot.stage,
      error: slot.error,
      publishedAt: slot.publishedAt,
      postUrl: slot.postUrl,
      publishLinks: slot.publishLinks,
      progressHistory: slot.progressHistory,
      scriptAngle: slot.scriptAngle,
      retryable: slot.retryable,
      queuePosition: slot.queuePosition,
      queueTotal: slot.queueTotal,
      userNotices: slot.userNotices,
      providerFailures: slot.providerFailures,
      media: slot.media,
    },
    schedule: {
      id: schedule.id,
      personaId: schedule.personaId,
      providers: schedule.providers,
      youtubeAccountIds: schedule.youtubeAccountIds,
      instagramAccountIds: schedule.instagramAccountIds,
      linkedinAccountIds: schedule.linkedinAccountIds,
      blueskyAccountIds: schedule.blueskyAccountIds,
      threadsAccountIds: schedule.threadsAccountIds,
      facebookAccountIds: schedule.facebookAccountIds,
      pinterestAccountIds: schedule.pinterestAccountIds,
      pinterestBoardId: schedule.pinterestBoardId,
      threespeakAccountIds: schedule.threespeakAccountIds,
      rumbleAccountIds: schedule.rumbleAccountIds,
      fanvueAccountIds: schedule.fanvueAccountIds,
      telegramAccountIds: schedule.telegramAccountIds,
      timezone: schedule.timezone,
      publishMode: schedule.publishMode,
    },
    persona: persona === null ? null : { id: persona.id, name: persona.name },
  };
}
