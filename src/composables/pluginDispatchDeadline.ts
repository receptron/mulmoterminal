import { isRequestTimeout } from "../utils/requestTimeout";

// A movie render answers only when done, so a minute is too short; MulmoClaude sets no bound, this host keeps one so a hung request still ends.
export const PLUGIN_DISPATCH_TIMEOUT_MS = 60 * 60_000;

const MS_PER_MINUTE = 60_000;

const isAbortError = (err: unknown): boolean => typeof err === "object" && err !== null && "name" in err && err.name === "AbortError";

/** What a failed dispatch should throw: a deadline abort says it timed out, anything else is kept. */
export function pluginDispatchError(toolName: string, err: unknown, timeout_ms: number): unknown {
  if (!isRequestTimeout(err) && !isAbortError(err)) return err;
  const minutes = Math.round(timeout_ms / MS_PER_MINUTE);
  return new Error(`plugin/${toolName} gave no answer within ${minutes} minutes. The work may still be running on the server.`, { cause: err });
}
