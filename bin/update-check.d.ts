export declare function fetchLatestVersion(pkg?: string): Promise<string | null>;
export declare function isNewerVersion(latest: string, current: string): boolean;
export declare function runGit(pkgDir: string, gitArgs: string[], timeout_ms?: number): Promise<string | null>;
export interface UpdateNoticeDeps {
  runGit?: (args: string[]) => Promise<string | null>;
  fetchLatest?: () => Promise<string | null>;
}
export declare function computeUpdateNotice(pkgDir: string, currentVersion: string, deps?: UpdateNoticeDeps): Promise<string | null>;
export declare function isUpdateCheckDisabled(env: Record<string, string | undefined>): boolean;
export declare function hasNodeModulesSegment(pkgDir: string): boolean;
export declare function classifyInstall(pkgDir: string, isGitWorkTree: boolean): "npm" | "git";
export declare function parseLsRemoteHead(stdout: string | null | undefined): string | null;
export declare function npmUpdateNotice(current: string, latest: string | null): string | null;
export declare function isTreeDirtyForUpdate(porcelain: string | null | undefined): boolean;
export declare function gitUpdateNotice(args: { localSha: string | null; localShort: string | null; remoteSha: string | null; dirty: boolean }): string | null;
