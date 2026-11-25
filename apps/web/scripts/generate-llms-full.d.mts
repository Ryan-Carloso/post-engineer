export declare function buildLlmsFull(input: {
  llms: string;
  apiDocs: string;
  toolNames: string[];
  toolActions: Record<string, string[]>;
}): string;
export declare function generateLlmsFull(repoRoot?: string): string;
