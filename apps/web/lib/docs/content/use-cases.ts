import type { DocPage } from '../types';

export const useCasesGuide: DocPage = {
  section: 'docs',
  slug: 'use-cases',
  title: { en: 'Use cases' },
  description: {
    en: 'What agents build with Post Engineer: daily videos, series and scheduled campaigns.',
  },
  updatedAt: '2026-11-26',
  contentHash: '3de6f516adb70ecb0383b9d2fde4f27bc13b87572a4bcb8257fa01d86e01cb61',
  blocks: [
    {
      kind: 'paragraph',
      text: {
        en: 'Post Engineer turns a script into a finished video and publishes it on a schedule. Agents use it for work that repeats every day, not one-off edits.',
      },
    },
    { kind: 'heading', level: 2, text: { en: 'Daily videos' } },
    {
      kind: 'paragraph',
      text: {
        en: 'A persona publishes one short video a day in its niche: the agent writes the script, generates the video and schedules it for the next morning.',
      },
    },
    { kind: 'heading', level: 2, text: { en: 'Series' } },
    {
      kind: 'paragraph',
      text: {
        en: 'A series keeps the same persona, voice and look across episodes. Each episode follows the previous one, so the audience comes back for the next part.',
      },
    },
    { kind: 'heading', level: 2, text: { en: 'Scheduled campaigns' } },
    {
      kind: 'paragraph',
      text: {
        en: 'A campaign is a batch of videos spread over days: the agent generates them all at once and each one goes out at its slot.',
      },
    },
  ],
};
