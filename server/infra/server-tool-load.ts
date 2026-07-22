// The two load-time decisions for a server-tool package, out of the async importer that reads
// process.env and the module namespace directly.
//
// requiredEnv: a server-only tool (e.g. an X/Twitter plugin) whose required env vars are not
// all set is DROPPED, so claude never sees a tool it cannot run. Invert or mis-key this and
// either a credential-less tool reaches the broker — claude calls it mid-task, gets a
// missing-token error, wastes a turn — or a perfectly runnable tool silently disappears.
//
// soleExecutor: a package that ships no `execute`/`pluginCore.execute` but a single
// descriptively-named `execute*` function is loaded by picking that one. Two such exports →
// give up (ambiguous), rather than choosing arbitrarily.

// Which of a tool's required env vars are absent from the given environment.
export function missingRequiredEnv(requiredEnv: readonly string[] | undefined, env: NodeJS.ProcessEnv): string[] {
  return (requiredEnv ?? []).filter((key) => !env[key]);
}

// A tool loads only when none of its required env vars is missing.
export function serverToolEnabled(requiredEnv: readonly string[] | undefined, env: NodeJS.ProcessEnv): boolean {
  return missingRequiredEnv(requiredEnv, env).length === 0;
}

// The sole `execute*` function export, or undefined when there is not exactly one — the
// fallback executor for packages that name their entry point descriptively and ship no
// `execute`. Undefined for zero (nothing to pick) and for two or more (ambiguous).
export function soleExecutor(mod: Record<string, unknown>): ((...args: unknown[]) => unknown) | undefined {
  const fns = Object.entries(mod).filter(([key, val]) => key.startsWith("execute") && typeof val === "function");
  return fns.length === 1 ? (fns[0][1] as (...args: unknown[]) => unknown) : undefined;
}
