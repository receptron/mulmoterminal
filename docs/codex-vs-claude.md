# Codex vs Claude Code — behavioral differences and how MulmoTerminal handles them

MulmoTerminal hosts both `claude` and `codex` as first-class agents. The two CLIs
differ in ways that reach every layer — session identity, resume, MCP delivery,
permissions, and how a skill is invoked. This document records each difference and
the choice MulmoTerminal makes for it, so the codex path and any future adapter stay
consistent.

**Layer note.** MulmoClaude's agent-backend abstraction (receptron/mulmoclaude#813)
abstracts the *programmatic* backend for MulmoClaude's own agent runs. MulmoTerminal's
codex work is a *different layer* — codex running as an **interactive TUI inside a
browser PTY**. The two share the behavioral differences below but not the code path.
Re-aligning with the upstream abstraction is an option, not a dependency.

## The adapter seam

Everything agent-specific lives behind `AgentAdapter` (`server/agents/types.ts`), with
`claude.ts` and `codex.ts` as the implementations and `registry.ts` resolving them. The
PTY persistence, reattach, grid, pubsub, MCP broker, and GUI panel are all shared.

## Differences

| Area | Claude Code | Codex CLI | MulmoTerminal's choice |
|---|---|---|---|
| **Session id** | server mints and forces it via `--session-id` | codex mints its own; there is no `--session-id` | keep the mulmoterminal key, then discover codex's rollout id after spawn |
| **Resume** | `--resume <id>` | `resume <id>` **subcommand** (global flags must precede it) | `buildCodexArgs` places `resume` after the flags |
| **Transcript on disk** | `~/.claude/projects/**/<id>.jsonl` | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | watch for the session's whole lifetime, and attribute only unambiguously |
| **When the transcript appears** | written as the turn runs | **only after the first user turn** — can be minutes | never assume a rollout exists right after spawn |
| **MCP delivery** | `--mcp-config <json>` + `--strict-mcp-config` | TOML config | inline `-c mcp_servers.mulmoterminal-gui.url="…"` — see below |
| **Tool permission** | per-tool `--allowedTools` | per-server only (coarse) | `default_tools_approval_mode="approve"` on the one GUI server |
| **System prompt** | `--system-prompt <str>` | **none** — it must be prepended to the user message (or live in AGENTS.md) | collection *actions* are self-contained natural language, so they carry their own instructions |
| **Draft-ready TUI marker** | `shift+tab to cycle` (stable) | **no stable marker** — the input placeholder rotates | claude sets `draftReadyMarker`; codex omits it, so editable-draft injection is claude-only |
| **Skill invocation** | `/<slug>` slash commands | no `/<slug>` commands, but it loads `~/.codex/skills/*/SKILL.md` by description | mirror the workspace's skills into codex's skills dir |
| **Auth** | `~/.claude` (Keychain on macOS) | `~/.codex/auth.json` (plain file, no Keychain) | codex is simpler to mount for Docker — no Keychain overlay |

## Why we diverge on MCP delivery

Upstream MulmoClaude uses a scratch `config.toml` plus `CODEX_HOME`. MulmoTerminal
injects inline `-c` overrides instead, for two reasons:

1. `CODEX_HOME=<scratch>` would relocate codex's rollout files out of `~/.codex`, which
   **breaks the sidebar session listing** — it reads `~/.codex/sessions`.
2. `-c` overrides **respect the user's own `~/.codex/config.toml`** and add the GUI
   server on top. A scratch home would ignore the user's config entirely.

## Skills in codex

Codex has no slash commands, so a `/<slug>` seed has nothing to bind to. Instead the
workspace's `.claude/skills` are **mirrored** into codex's skills dir (same `SKILL.md`
format), where codex loads them by description.

The mirror is marked so a re-sync overwrites only MulmoTerminal's own copies and never
clobbers codex's curated or system skills. Any directory whose name isn't a clean slug
is skipped, so a name containing whitespace or quotes can't alter the injected prompt.

## What this implies for future adapters

- A new agent needs: a binary + env override, argv construction, a way to learn its
  native session id, a resume form, MCP injection with auto-approve, and skill paths.
- The GUI-MCP broker is **agent-agnostic** — the session id lives only in the URL path
  and results are published on a per-session channel. Any MCP client pointed at that
  URL with its tools auto-approved drives the same GUI panel. So MCP support for a new
  agent is config injection, not new server code.
- The genuinely new pattern versus Claude is id ownership: Claude lets the server force
  an id, while codex (and likely others) mint their own. That inverts the flow to
  "launch → discover id → resume".

## Related

- Codex work: sidebar list + resume (#249), GUI-panel parity (#240), collection actions
  and skills in codex (#257) — all shipped in `mulmoterminal@0.8.0`.
- Multi-agent tracking issue: #236.
- Upstream agent-backend abstraction: receptron/mulmoclaude#813.
