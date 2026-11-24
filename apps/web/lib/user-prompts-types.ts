import type { z } from 'zod';
import type { PromptSummarySchema, PromptVersionSummarySchema } from '@/lib/contracts/prompts';

export type PromptSummary = z.output<typeof PromptSummarySchema>;

export type PromptVersionSummary = z.output<typeof PromptVersionSummarySchema>;
