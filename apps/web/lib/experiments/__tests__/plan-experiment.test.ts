import { describe, expect, it } from 'vitest';
import type { CreateExperimentBody } from '@/lib/contracts/experiments';
import { planExperimentSlots } from '../plan-experiment';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function video(title: string): CreateExperimentBody['prompts'][number]['videos'][number] {
  return { title, description: `Description for ${title}` };
}

function body(overrides: Partial<CreateExperimentBody> = {}): CreateExperimentBody {
  return {
    name: 'Hook test',
    personaId: '33333333-3333-4333-8333-333333333333',
    videoType: 'voiceover',
    prompts: [
      { promptVersionId: A, videos: [video('a1'), video('a2'), video('a3'), video('a4'), video('a5')] },
      { promptVersionId: B, videos: [video('b1'), video('b2'), video('b3'), video('b4'), video('b5')] },
    ],
    videosPerPrompt: 5,
    postsPerDay: 2,
    providers: ['youtube'],
    startAt: '2026-12-01T00:00:00',
    times: ['09:00', '18:00'],
    timezone: 'UTC',
    ...overrides,
  };
}

describe('planExperimentSlots', () => {
  it('interleaves prompts round by round', () => {
    const result = planExperimentSlots(body());
    if (!result.ok) throw new Error(result.error);
    expect(result.slots.map((slot) => slot.title)).toEqual(['a1', 'b1', 'a2', 'b2', 'a3', 'b3', 'a4', 'b4', 'a5', 'b5']);
    expect(result.slots.map((slot) => slot.promptVersionId)).toEqual([A, B, A, B, A, B, A, B, A, B]);
  });

  it('spreads slots over days at postsPerDay per day', () => {
    const result = planExperimentSlots(body());
    if (!result.ok) throw new Error(result.error);
    const days = result.slots.map((slot) => slot.slotAtISO.slice(0, 10));
    expect(days).toEqual([
      '2026-12-01', '2026-12-01',
      '2026-12-02', '2026-12-02',
      '2026-12-03', '2026-12-03',
      '2026-12-04', '2026-12-04',
      '2026-12-05', '2026-12-05',
    ]);
    expect(result.endAt).toBe(result.slots[result.slots.length - 1]?.slotAtISO);
  });

  it('rejects a prompt with the wrong number of videos', () => {
    const result = planExperimentSlots(body({
      prompts: [
        { promptVersionId: A, videos: [video('a1')] },
        { promptVersionId: B, videos: [video('b1'), video('b2'), video('b3'), video('b4'), video('b5')] },
      ],
    }));
    expect(result.ok).toBe(false);
  });

  it('rejects duplicate prompt versions', () => {
    const result = planExperimentSlots(body({
      prompts: [
        { promptVersionId: A, videos: [video('a1'), video('a2'), video('a3'), video('a4'), video('a5')] },
        { promptVersionId: A, videos: [video('b1'), video('b2'), video('b3'), video('b4'), video('b5')] },
      ],
    }));
    expect(result.ok).toBe(false);
  });

  it('rejects times that do not match postsPerDay', () => {
    const result = planExperimentSlots(body({ postsPerDay: 3 }));
    expect(result.ok).toBe(false);
  });
});
