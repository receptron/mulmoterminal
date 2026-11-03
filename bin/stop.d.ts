import type { InstanceEntry } from "./instances.js";

export interface StopEffects {
  kill?: (pid: number) => void;
  request?: (instance: InstanceEntry) => Promise<boolean>;
  isAlive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
  graceMs?: number;
  confirm?: (instance: InstanceEntry) => Promise<boolean>;
  force?: boolean;
}
export interface StubbornInstance extends InstanceEntry {
  reason: string;
}
export interface StopResult {
  stopped: InstanceEntry[];
  stubborn: StubbornInstance[];
  unconfirmed: InstanceEntry[];
}
export type StopArgs = { help: true } | { error: string } | { force: boolean; port: number | null };

export declare const STOP_USAGE: string;
export declare function parseStopArgs(args: readonly string[]): StopArgs;
export declare function selectByPort(instances: readonly InstanceEntry[], port: number | null): InstanceEntry[];
export declare function noServerOnPortReport(port: number, instances: readonly InstanceEntry[]): string[];
export interface ConfirmDeps {
  owners?: (port: number) => Promise<number[] | null>;
}
export declare function confirmInstance(instance: InstanceEntry, deps?: ConfirmDeps): Promise<boolean>;
export interface AskDeps {
  fetchImpl?: (url: string, init: RequestInit) => Promise<{ ok: boolean }>;
  timeoutMs?: number;
}
export declare function askServerToStop(instance: InstanceEntry, deps?: AskDeps): Promise<boolean>;
export declare function stopInstances(instances: readonly InstanceEntry[], effects?: StopEffects): Promise<StopResult>;
export declare function describeInstance(instance: InstanceEntry): string;
export declare function manualStopCommand(pids: readonly number[], platform?: NodeJS.Platform): string;
export declare function stopReport(result: StopResult, platform?: NodeJS.Platform, stopCommand?: string): string[];
export declare function stopExitCode(result: StopResult): number;
export declare function runStop(args?: readonly string[]): Promise<void>;
