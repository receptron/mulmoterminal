// What each spawner looks like to the modules that are handed one.
//
// Derived from the factory that produces it rather than written out again, because a route
// module can only declare what it needs by describing a function it does not own — and two
// modules describing the same six-argument positional signature by hand is a copy that can
// drift from the implementation without anything noticing (#548).
import type { createClaudeSpawner } from "./spawn-claude.js";
import type { createCodexSpawner } from "./spawn-codex.js";
import type { createShellSpawners } from "./spawn-shell.js";

export type SpawnClaudePty = ReturnType<typeof createClaudeSpawner>["spawnClaudePty"];
export type SpawnCodexPty = ReturnType<typeof createCodexSpawner>["spawnCodexPty"];
export type SpawnCommandPty = ReturnType<typeof createShellSpawners>["spawnCommandPty"];
export type SpawnLauncherPty = ReturnType<typeof createShellSpawners>["spawnLauncherPty"];
export type ResolveLauncher = ReturnType<typeof createShellSpawners>["resolveLauncher"];
