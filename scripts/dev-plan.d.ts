export interface DevScript {
  name: string;
  script: string;
}
export declare const DEV_SCRIPTS: readonly DevScript[];
export type DevRunPlan = { kind: "concurrently"; args: string[] } | { kind: "direct"; scripts: readonly DevScript[] };
export declare function devRunPlan(platform: string, env?: Record<string, string | undefined>): DevRunPlan;
export declare function combinedExitCode(codes: readonly (number | null)[]): number;
