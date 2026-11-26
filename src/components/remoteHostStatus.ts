// Whether a cell's remote host (#3506) is still configured, from what this page knows of the list.
// Unknown means the list has not answered yet; failed means it could not be read, and is treated as
// present, so a server that cannot answer leaves remote cells exactly as they were before the list.
export type ConfiguredHosts = { state: "loading" } | { state: "failed" } | { state: "known"; ids: readonly string[] };

export type RemoteHostStatus = "local" | "pending" | "present" | "gone";

export function remoteHostStatus(host: string | null | undefined, configured: ConfiguredHosts): RemoteHostStatus {
  if (typeof host !== "string" || host === "") return "local";
  if (configured.state === "loading") return "pending";
  if (configured.state === "failed") return "present";
  return configured.ids.includes(host) ? "present" : "gone";
}

/** Pending waits for the list rather than connecting: a socket opened to a removed host retries forever. */
export const mayConnect = (status: RemoteHostStatus): boolean => status === "local" || status === "present";
