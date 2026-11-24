import type { CreateExperimentBody } from '@/lib/contracts/experiments';
import { distributeSlots } from '@/lib/schedule/slot-distribution';

export interface PlannedExperimentSlot {
  promptVersionId: string;
  videoIndex: number;
  title: string;
  description: string;
  segments: CreateExperimentBody['prompts'][number]['videos'][number]['segments'];
  slotAtISO: string;
}

export type PlanExperimentResult =
  | { ok: true; slots: PlannedExperimentSlot[]; endAt: string }
  | { ok: false; error: string };

export function planExperimentSlots(body: CreateExperimentBody): PlanExperimentResult {
  for (const prompt of body.prompts) {
    if (prompt.videos.length !== body.videosPerPrompt) {
      return { ok: false, error: `Prompt ${prompt.promptVersionId} has ${prompt.videos.length} videos; exactly ${body.videosPerPrompt} are required.` };
    }
  }
  const seen = new Set<string>();
  for (const prompt of body.prompts) {
    if (seen.has(prompt.promptVersionId)) return { ok: false, error: `Duplicate promptVersionId ${prompt.promptVersionId}.` };
    seen.add(prompt.promptVersionId);
  }
  if (body.times.length !== body.postsPerDay) {
    return { ok: false, error: `times must list exactly postsPerDay (${body.postsPerDay}) publishing times, one per post per day.` };
  }
  const total = body.prompts.length * body.videosPerPrompt;
  let distributed;
  try {
    distributed = distributeSlots({ startAtISO: body.startAt, times: body.times, timezone: body.timezone, count: total });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid publishing schedule.' };
  }
  const slots: PlannedExperimentSlot[] = [];
  for (let videoIndex = 0; videoIndex < body.videosPerPrompt; videoIndex += 1) {
    for (const prompt of body.prompts) {
      const video = prompt.videos[videoIndex];
      if (video === undefined) return { ok: false, error: `Prompt ${prompt.promptVersionId} is missing video ${videoIndex + 1}.` };
      const slot = distributed[slots.length];
      if (slot === undefined) return { ok: false, error: 'Could not distribute every video.' };
      slots.push({
        promptVersionId: prompt.promptVersionId,
        videoIndex,
        title: video.title,
        description: video.description,
        segments: video.segments,
        slotAtISO: slot.slotAtISO,
      });
    }
  }
  const endAt = slots[slots.length - 1]?.slotAtISO ?? body.startAt;
  return { ok: true, slots, endAt };
}
