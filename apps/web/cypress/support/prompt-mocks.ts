export const PROMPT_VERSION_ID = '44444444-4444-4444-8444-444444444444';

export interface PromptSummaryMock {
  slug: string;
  title: string;
  description: string;
  source: string;
  visibility: string;
  verified: boolean;
}

export const promptDetail = (summary: PromptSummaryMock, body: string) => ({
  ...summary,
  prompt: body,
  body,
  versionId: PROMPT_VERSION_ID,
  version: 1,
});
