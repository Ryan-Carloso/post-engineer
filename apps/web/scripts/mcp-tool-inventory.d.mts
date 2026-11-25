export declare const NO_ACTION_TOOLS: readonly string[];
export declare const SPECS_TO_TOOL: Readonly<Record<string, string>>;
export declare function registeredToolNames(repoRoot: string): string[];
export declare function registeredToolActions(repoRoot: string): Record<string, string[]>;
export declare function specKeys(repoRoot: string, file: string, constName: string): string[];
