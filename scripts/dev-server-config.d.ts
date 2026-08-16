export declare function resolveWatchDirs(env: Record<string, string | undefined>, root: string): string[];
export declare function shouldSchedule(state: { shuttingDown: boolean; restartPending: boolean }): boolean;
export declare function isReloadableChange(filename: unknown): boolean;
export declare const PORT_IN_USE_EXIT_CODE: number;
export declare function restartPlan(exit: {
  code: number | null;
  signal: string | null;
  consecutiveFailures: number;
  minDelayMs: number;
  maxDelayMs: number;
}): { retry: boolean; delayMs: number; reason: string };
export declare function isListeningMessage(msg: unknown): boolean;
