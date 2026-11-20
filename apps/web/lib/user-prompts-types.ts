import type { z } from 'zod';
import type { PromptSummarySchema } from '@/lib/contracts/prompts';

export type PromptSummary = z.output<typeof PromptSummarySchema>;
