# feat: multi-agent support — Codex (then Antigravity) as first-class agents

Tracking issue: receptron/mulmoterminal#236
Integration branch: `feat/multi-agent` (off `main`). PRs stack onto it; final PR merges to `main`.

## Goal

Let a MulmoTerminal session run a non-Claude agent CLI **as a first-class agent**, equal to Claude:
session resume across reload, single-mode GUI panel over MCP, and skill/collection runs.
Target order: **Codex first**, then **Antigravity (`agy`)**. Design so a third agent is additive.

## What already exists (seams to build on)

- **Three spawn paths** in `server/index.ts`: `/ws` → `spawnClaudePty` (Claude, first-class),
  `/ws/launch` → `spawnLauncherPty` (arbitrary command, persistent+reattachable),
  `/ws/run` → `spawnCommandPty` (ephemeral). All funnel through `spawnPty()` (`server/index.ts:1503`).
- **Single binary choke point**: `CLAUDE_BIN = process.env.CLAUDE_BIN || "claude"` (`server/index.ts:136`),
  consumed only at `server/index.ts:1549`.
- **Argv builder**: `buildClaudeArgs` (`server/claude-args.ts:23`) — Claude-specific flags
  (`--session-id`/`--resume`/`--settings`/`--permission-mode`/`--mcp-config`/`--strict-mcp-config`/`--allowedTools`).
- **Session id**: the server MINTS it and forces it via `--session-id`; it is NOT parsed from output.
  Reported to the client as `{type:"session", id, cwd}` (`server/index.ts:1817`).
- **GUI-MCP is agent-agnostic**: `mcpConfigJson(sessionId)` points the agent at
  `http://127.0.0.1:PORT/api/mcp/<sessionId>` (`server/index.ts:625`); the broker
  (`server/mcp/broker.ts`, `buildGuiMcpServer`) keys everything by the URL's sessionId and publishes
  tool results on `session:<id>` (`sessionChannel`, `server/index.ts:245`) → `GuiPanel.vue` renders.
  The broker comment already anticipates a Docker sandbox (`server/mcp/broker.ts:23`).
- **Launcher config**: `Launcher {label, command}` in `~/.mulmoterminal/config.json`
  (`server/app-config.ts:12`), editable in `SettingsModal.vue`.
- **Skill run**: a collection IS a skill; the plugin seeds `/<slug> …` and injects it 3 ways —
  initial argv prompt, bracketed-paste **draft** after `DRAFT_READY_MARKER=/shift+tab to cycle/`
  (`server/index.ts:1476`), or `input` frames into a live PTY. Skill dirs hardcoded to
  `.claude/skills` / `data/skills` (`server/backends/collections.ts:70-76`).
- **Docker sandbox already exists** (`server/sandbox.ts` + `Dockerfile.sandbox`, opt-in
  `MULMOTERMINAL_SANDBOX=1`, single-view + macOS only, verified in #202). It wraps `claude` in
  `docker run`, mounts the cwd at its same path + `~/.claude` (auth/transcripts) + a per-session
  `~/.claude.json`, overlays the macOS Keychain credential, and — the key part — the container
  reaches the host GUI-MCP + hooks over `host.docker.internal`. `server.listen(PORT)` binds all
  interfaces; `rewriteLoopbackForDocker()` (`sandbox.ts:44`) rewrites the MCP/hook URLs
  `127.0.0.1`→`host.docker.internal` (`server/index.ts:652,1661`). `buildDockerRunArgs`
  (`sandbox.ts:233`) hardcodes `"claude", ...claudeArgs` at the tail (`:268`) — the one spot that
  is agent-specific.

## Target design: `AgentAdapter`

One interface owning everything agent-specific; all shared plumbing (PTY persistence, reattach, grid,
pubsub, broker, GuiPanel) stays untouched.

```
type AgentKind = "claude" | "codex" | "antigravity";
type Runtime = "host" | "docker";

interface AgentAdapter {
  kind: AgentKind;
  bin(): string;                                   // env override per agent
  buildArgs(ctx): string[];                        // session/resume, model, approval, MCP inject
  captureSessionId(ctx): Promise<string> | string; // claude: minted; codex/agy: discover/parse
  resumeArgs(id): string[];                         // codex resume <id> / agy --conversation <id>
  mcpInject(url): string[] | ConfigWrite;          // point at GUI-MCP + auto-approve its tools
  draftReadyMarker: RegExp;                          // TUI status line for draft typing
  skillSeed(seed): Injection;                        // how a skill/collection prompt enters the agent
  paths: { userSkills; projectSkills; sessions; };
}
```

Claude becomes the first adapter with a **no-behavior-change** refactor.
The `Runtime` dimension already exists for Claude as the single-view Docker sandbox
(`server/sandbox.ts`): it wraps `bin()`/args in `docker run …` and the MCP-URL host swap is done by
`rewriteLoopbackForDocker()`. Generalizing it = parametrizing the hardcoded `claude` tail + per-agent
auth mounts (see Docker section under PR#5).

## Client protocol change

Add an **agent kind** alongside the existing launcher index in `ConnTarget`
(`useTerminalConnections.ts:28`) and the `/ws` query (`wsUrl.ts`), plus the grid cell model
(`gridTabs.ts`) and a way to pick the agent for a cell / single view.

---

## PR stack

### PR#0 — scaffolding + CI
- Add `feat/multi-agent` to `push` + `pull_request` branch triggers in `.github/workflows/ci.yml`
  and `.github/workflows/codex_review.yaml` (both currently `[main, dev_tool]` only).
- Introduce `AgentAdapter` + a registry; move Claude's bin/args/marker/paths behind the Claude adapter.
- (GUI-MCP URL host is already parametrized via `mcpConfigJson(id, host, sandbox)` + `rewriteLoopbackForDocker`
  — no new work needed here; just keep it adapter-reachable.)
- **Acceptance**: no behavior change; `yarn lint/build/typecheck/test` green; CI runs on the branch.

### PR#1 — Codex L1+L2 (first-class session + resume)
- `CODEX_BIN = process.env.CODEX_BIN || "codex"`; `server/codex-args.ts` (model `-m`, `--ask-for-approval`,
  `--sandbox`, resume).
- **Session id discovery**: after spawn, find the newest `~/.codex/sessions/**/rollout-*.jsonl` created
  after launch; read `session_meta.payload.id` (+ `cwd`); store; emit `{type:"session", id}`. Poll briefly
  if the file lags spawn.
- Resume via `codex resume <id>` (or `-c experimental_resume=<path>`).
- Client: agent kind in `ConnTarget` / `wsUrl` / grid cell + agent picker.
- **Acceptance**: pick Codex for a cell → runs; reload/restart → same codex conversation resumes.

### PR#2 — Codex L3 (GUI-MCP in single mode)
- Inject GUI-MCP per session: `-c 'mcp_servers.mulmoterminal-gui.url="http://<host>:PORT/api/mcp/<id>"'`
  `-c 'mcp_servers.mulmoterminal-gui.default_tools_approval_mode="approve"'` (broker unchanged).
- Ensure the mulmoterminal session key (GUI channel + MCP URL) matches the GuiPanel binding for a codex
  single-mode session (mulmoterminal-minted key is fine; codex's rollout id is only for resume).
- **Acceptance**: from a codex single-mode session, `presentChart`/`presentForm`/`presentCollection`/
  `generateImage` render in the GUI panel.

### PR#3 — Codex L4 (skill / collection run)
- Codex-specific `draftReadyMarker` (its TUI status line).
- Map collection/skill seed → codex invocation; per-agent skill paths (`~/.codex/skills`) in
  `configureCollectionHost`.
- **Acceptance**: running a collection action / chat seed against a codex session injects correctly.

### PR#4 — Antigravity (`agy`)
- `ANTIGRAVITY_BIN`; adapter: argv (`--model`, `--dangerously-skip-permissions`, `--conversation <id>`),
  session capture (parse the resume line agy prints on exit / scan `~/.gemini` store), MCP via
  `mcp_config.json` `url` server, skills via `/skills`.
- Resolve open unknowns on a machine with `agy` installed.
- **Acceptance**: same L1–L4 checks for Antigravity.

### PR#5 — Docker sandbox (generalize existing) + docs + integration tests + merge
- **Generalize `server/sandbox.ts`** (the container→host GUI-MCP path is already #202-verified for Claude):
  - Parametrize `buildDockerRunArgs` tail (`sandbox.ts:268`, hardcoded `"claude", ...`) by adapter.
  - Per-agent auth mounts: Codex → mount `~/.codex` r/w (plain `auth.json`, no Keychain — simpler than
    Claude); Antigravity → mount `~/.gemini` incl. `antigravity-cli/`.
  - Mounting `~/.codex` r/w also surfaces the rollout sessions dir on the host → **L2 id discovery works
    in-container** (auth mount doubles as id source).
  - Extend `Dockerfile.sandbox` to carry `codex` / `agy`.
  - Codex in-container: `--sandbox danger-full-access`. Consider Linux support (no Keychain dep; needs the
    `--user` uid-mapping #202 follow-up).
- README.md + CLAUDE.md: agent selection, `CODEX_BIN`/`ANTIGRAVITY_BIN`, `MULMOTERMINAL_SANDBOX` per agent.
- Codex stub integration test mirroring the Claude `/ws` stub in `ci.yml`.
- Merge `feat/multi-agent` → `main`.

## Open questions (need a working binary)

- Codex: `-c mcp_servers.x.url` per-session injection actually registers the server; rollout-file timing
  for id capture; codex TUI marker string; first-turn skill/slash invocation UX.
- Antigravity: on-disk session path + programmatic id capture; per-session MCP injection vs config file;
  agy TUI markers.

## Environment prerequisites

- Repair local `codex` (`@openai/codex` reinstall; vendor binary `ENOENT` after a Node upgrade).
- Install `agy` for Antigravity work.
- Unit tests + build need neither; CI stubs the CLIs.

## Constraints / conventions

- Follow repo git rules: feature branch per PR onto `feat/multi-agent`; no `git add .`; merge commits;
  `feat:`/`refactor:`/`fix:` prefixes; PR body carries Summary + Items-to-Confirm first, then the user prompt.
- `script.json` in the working tree is a local, untracked convenience file — never commit it.
