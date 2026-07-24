// Only the surface probeOnce actually touches — narrower than http.ClientRequest /
// IncomingMessage on purpose, so a test fake and the real node:http both satisfy it.
export interface ProbeRequest {
  on(event: "error" | "timeout", listener: (...args: unknown[]) => void): unknown;
  destroy(): void;
}

export interface ProbeResponse {
  resume(): void;
}

export type ProbeGet = (opts: { host: string; port: number; path: string; timeout: number }, cb: (res: ProbeResponse) => void) => ProbeRequest;

export declare function probeOnce(get: ProbeGet, port: number, timeoutMs?: number): Promise<"ready" | "retry">;

export declare function waitUntilReady(
  port: number,
  onReady: () => void,
  deps?: {
    get?: ProbeGet;
    now?: () => number;
    timeoutMs?: number;
    intervalMs?: number;
    readyTimeoutMs?: number;
  },
): () => void;
