// @vitest-environment node
// Which text each agent actually receives when a seeded chat is spawned.
//
// This is the invariant that keeps a reported bug from being real (#1939). The Settings skill
// buttons build a CLAUDE-shaped seed — `skillSeed(skill, "claude")` in GridView, literally
// `/mulmoterminal-theme` — while the spawn follows the user's "Launch with" toggle, which may be
// muse. Read from the client alone that looks like a slash command being handed to an agent that
// has no slash commands. It is not, because `spawnSeededSession` codexifies the seed for every
// NON-claude branch before it reaches the spawner.
//
// Nothing pinned that. `spawnSeededSession` is a five-branch fan-out and each non-claude branch
// has to pass `initialPrompt` (the rewritten text) rather than `message` (the raw one) — a new
// agent added without it re-creates exactly the bug, silently, in a path no test walks. So the
// route is driven for real, once per agent, and the string each spawner is handed is captured.
import { describe, it, expect, vi } from "vitest";
import express from "express";
import { routeCall, jsonPost } from "../../helpers/routeCall";
import { TERMINAL_AGENTS } from "../../../common/sessionAgent";

// Same reason as worker-failure-wiring.spec.ts: process.env is shared across a vitest worker, so
// pointing HOME at a temp dir reaches unrelated specs. What is under test is the in-memory
// decision, and persistence has its own spec.
vi.mock("node:fs", () => {
  const promises = {
    readFile: vi.fn(async () => ""),
    appendFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
  const realpathSync = Object.assign(
    vi.fn((p: string) => p),
    { native: vi.fn((p: string) => p) },
  );
  return { promises, realpathSync, default: { promises, realpathSync } };
});

const { mountPluginRoutes } = await import("../../../server/routes/plugin-routes.js");

/** What one spawner was handed: the auto-run text, or the draft typed into the input box. */
interface Seen {
  initialPrompt?: string | undefined;
  draft?: string | undefined;
  /** What `groupsForSpawn` decided for this agent — see the describe block at the end. */
  mcpGroups?: readonly string[] | undefined;
}
const seen = new Map<string, Seen>();
const record =
  (agent: string, read: (args: unknown[]) => Seen) =>
  (...args: unknown[]) => {
    seen.set(agent, read(args));
    return {};
  };

/** claude's options are its 4th argument; the others take theirs 5th (codex) or 5th (agy/grok/muse). */
const lastOption = (args: unknown[]): Seen => {
  const opts = args.find((a, i) => i > 2 && a !== null && typeof a === "object");
  const o = (opts ?? {}) as Seen;
  return { initialPrompt: o.initialPrompt, draft: o.draft, mcpGroups: o.mcpGroups };
};

const app = express();
app.use(express.json());
mountPluginRoutes(app, {
  spawnClaudePty: record("claude", lastOption) as never,
  spawnCodexPty: record("codex", lastOption) as never,
  spawnAntigravityPty: record("antigravity", lastOption) as never,
  spawnGrokPty: record("grok", lastOption) as never,
  spawnMusePty: record("muse", lastOption) as never,
  spawnCopilotPty: record("copilot", lastOption) as never,
  spawnCursorPty: record("cursor", lastOption) as never,
  registerBackgroundSession: () => {},
});
const call = routeCall(app);

const SKILL_SEED = "/mulmoterminal-theme";
const CODEXIFIED = 'Use the "mulmoterminal-theme" skill.';

async function spawn(agent: string, message = SKILL_SEED, draft = false): Promise<Seen> {
  seen.delete(agent);
  await call("/api/plugin/spawnBackgroundChat", jsonPost({ message, agent, draft }));
  const got = seen.get(agent);
  if (!got) throw new Error(`the ${agent} spawner was never called`);
  return got;
}

describe("the seed each agent is handed", () => {
  // Claude is the one that HAS slash commands, so its seed must arrive untouched. Rewriting it
  // would turn a working `/slug` into prose for the only agent that wanted the command.
  it("hands claude the slash command unchanged", async () => {
    expect((await spawn("claude")).initialPrompt).toBe(SKILL_SEED);
  });

  // Everything else. Written from TERMINAL_AGENTS rather than a second list of names, so an agent
  // added to the picker fails HERE — with "the <agent> spawner was never called" or a raw `/slug`
  // — rather than shipping as a session that is told to run a command it cannot parse.
  it.each(TERMINAL_AGENTS.filter((a) => a !== "claude"))("rewrites the slash command for %s", async (agent) => {
    expect((await spawn(agent)).initialPrompt).toBe(CODEXIFIED);
  });

  // The rewrite is for SKILL seeds only: a collection action's prompt is already prose and must
  // reach the agent as written.
  it("leaves an ordinary prompt alone for every agent", async () => {
    const prose = "Repair the rows that lost their cover image.";
    for (const agent of TERMINAL_AGENTS) {
      expect((await spawn(agent, prose)).initialPrompt, agent).toBe(prose);
    }
  });

  // A claude DRAFT is typed into the input box for review instead of run, and it is the raw seed
  // for the same reason the claude run is.
  it("keeps a claude draft as the slash command, unrun", async () => {
    const got = await spawn("claude", SKILL_SEED, true);
    expect(got.draft).toBe(SKILL_SEED);
    expect(got.initialPrompt).toBeUndefined();
  });
});

// The directory's registered groups, so the decision below is observable. Mocked because the real
// lookup reads Claude Code's config files off the host.
vi.mock("../../../server/infra/gui-mcp-registration.js", () => ({ registeredGuiMcpGroups: vi.fn(async () => ["render"]) }));

describe("which agents are asked for the directory's tool groups", () => {
  // Pins the mapping THROUGH THE REAL ROUTE, per agent — which nothing did before.
  //
  // What it does NOT do, stated because the obvious claim is false and I checked: it does not fail
  // if `groupsForSpawn` goes back to enumerating "antigravity | grok | muse". Measured — restoring
  // that list leaves all of this green, because for the agents that exist TODAY the enumeration and
  // `!agentCarriesFullGuiMcp(agent)` are the same function. They differ only for an agent that does
  // not exist yet, which no runtime test can reach. The protection for the next one is the
  // derivation itself and the predicate's own spec (test/server/routes/agent-typed-lists.spec.ts);
  // this spec is the behavioural record of what the current set does.
  it("does not ask for an agent that carries the whole GUI MCP per spawn", async () => {
    for (const agent of ["claude", "codex", "copilot"]) {
      expect((await spawn(agent)).mcpGroups ?? []).toEqual([]);
    }
  });

  it("asks for an agent that reads its MCP from the directory", async () => {
    for (const agent of ["antigravity", "grok", "muse"]) {
      expect((await spawn(agent)).mcpGroups).toEqual(["render"]);
    }
  });
});
