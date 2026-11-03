export interface DevCommand {
  name: string;
  command: string;
}
export declare const DEV_COMMANDS: readonly DevCommand[];
export type DevRunPlan = { kind: "concurrently"; args: string[] } | { kind: "direct"; commands: readonly DevCommand[] };
export declare function devRunPlan(platform: string, env?: Record<string, string | undefined>): DevRunPlan;
export declare function combinedExitCode(codes: readonly (number | null)[]): number;
