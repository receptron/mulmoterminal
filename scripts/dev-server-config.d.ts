export declare function resolveWatchDirs(env: Record<string, string | undefined>, root: string): string[];
export declare function shouldSchedule(state: { shuttingDown: boolean; restartPending: boolean }): boolean;
export declare function isReloadableChange(filename: unknown): boolean;
