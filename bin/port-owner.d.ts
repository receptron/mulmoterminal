export interface PortOwnerCommand {
  file: string;
  args: string[];
}

/** What a failed lookup can tell us apart by: a missing binary (`ENOENT`), a killed one, or a
 *  non-zero exit that is really an answer ("nothing matched"). Declared here rather than reusing
 *  `typeof execFile` so a test can supply one without a cast. */
export type PortOwnerError = Error & { code?: string | number; killed?: boolean; signal?: string | null };

export type PortOwnerRunner = (
  file: string,
  args: readonly string[],
  options: { timeout: number; windowsHide: boolean },
  callback: (error: PortOwnerError | null, stdout: string, stderr?: string) => void,
) => void;

export interface PortOwnerDeps {
  platform?: NodeJS.Platform;
  run?: PortOwnerRunner;
  timeoutMs?: number;
}

export declare function portOwnerCommand(port: number, platform: NodeJS.Platform): PortOwnerCommand;
export declare function parsePortOwners(stdout: string): number[];
export declare function portOwners(port: number, deps?: PortOwnerDeps): Promise<number[] | null>;
