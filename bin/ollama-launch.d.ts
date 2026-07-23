export declare const OLLAMA_CONTEXT_LENGTH: number;
export declare const CLAUDE_MAX_OUTPUT_TOKENS: number;
export declare const OLLAMA_AUTH_TOKEN: string;
export declare const MINIMAL_PROMPT_FLAGS: string[];
export declare function parseClaudeOllamaArgs(argv: string[]): { help: boolean; model: string | null; claudeArgs: string[] };
export declare function buildClaudeEnv(baseEnv: Record<string, string | undefined>, model: string, baseUrl: string): Record<string, string | undefined>;
export declare function buildOllamaServeEnv(
  baseEnv: Record<string, string | undefined>,
  host: string,
  contextLength?: number,
): Record<string, string | undefined>;
export declare function buildClaudeArgs(claudeArgs: string[]): string[];
export declare function modelIsInstalled(tags: unknown, model: string): boolean;
