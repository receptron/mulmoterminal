export interface InstanceEntry {
  pid: number;
  port: number | null;
  startedAt: number | null;
}
export declare function instancesDir(): string;
export declare function isProcessAlive(pid: number): boolean;
export declare function registerInstance(port: number, pid?: number, startedAt?: number): () => void;
export declare function liveInstances(excludePid?: number): InstanceEntry[];
export interface ServingDeps {
  owners?: (port: number) => Promise<number[] | null>;
}
export declare function servingInstances(instances: readonly InstanceEntry[], deps?: ServingDeps): Promise<InstanceEntry[]>;
export declare function earliestStartedAt(instances: readonly InstanceEntry[]): number | null;
