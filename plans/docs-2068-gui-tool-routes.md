# docs: re-teach how each agent reaches the GUI tools

Issue: [#2068](https://github.com/receptron/mulmoterminal/issues/2068)

## The claim that was wrong

`docs/guide/{en,ja}/basics.md` taught the GUI-tool split as a **two-way** choice — a table with one
column for "Claude / Codex" and one for "Antigravity / Grok". The system has had more answers than
that since muse landed in 4.7.0, and two more arrived in 4.22.0. `config.md`, `glossary.md` and
`faq.md` repeated the same two-way model, and `README.md`'s table was missing two rows.

Ground truth is `common/guiMcpAgents.ts`, not prose:

| route | agents | what says so |
|---|---|---|
| a flag on the session itself | claude, codex, copilot | `FULL_GUI_MCP_AGENTS` |
| a config file in the working directory | antigravity, grok | `syncAntigravityMcpConfig`, `grok mcp add` |
| one plugin per machine, narrowed per session | muse | `server/agents/muse-mcp.ts` |
| neither — nothing writes the file it reads | cursor | `DIRECTORY_MCP_BLIND_AGENTS` (#2066) |

Two smaller claims were wrong for the same reason and are fixed here:

- `userMcpServers` was documented as reaching "a Claude session in the workspace, and only that".
  `mcpConfigJson` (which carries them) is called by `spawn-claude.ts` **and** `spawn-copilot.ts`,
  so a full-GUI **copilot** session gets them too. Codex does not — its path is `codexGuiMcpServers`.
- `config.md` listed the ids a `customAgents` entry may not use as "claude, codex, antigravity, grok
  or shell". `isCustomAgentId` rejects every member of `LAUNCH_AGENTS`, which is now eight.

## What this does NOT do

It does not widen `test/server/docs/agentSetClaims.spec.ts`. Two pattern rules for this class were
measured on #2065 and rejected: "a line naming four or more agents must name them all" flags 12
lines of which 11 are legitimate subsets, and a completeness-cue variant flags 26. This is prose
teaching a model; the fix is to teach the right one.

## Sites

- `docs/guide/{en,ja}/basics.md` — the routes table, the `userMcpServers` paragraph, the "keep doing
  what you did in 3.x" passage, the workspace-chip paragraph, the `#antigravity-gui-tools` section
  (retitled, **anchor kept** — README and four guide pages link to it), its procedure and its
  verification paragraph, and the "mixing agents" intro
- `docs/guide/{en,ja}/config.md` — the symptom-index row, the **MCP servers** row, the Agent Picker
  sentence, the reserved-id cell, the `CLAUDE_CWD` row
- `docs/guide/{en,ja}/glossary.md` — the cell definition, the Agent Picker entry, the workspace entry
- `docs/guide/{en,ja}/faq.md` — the "launch in the workspace" answer
- `README.md` — the per-cell table (copilot and cursor rows added) and the paragraph under it

## Verification

- every internal `*.html` link under `docs/guide` resolves to a real page (2 pre-existing
  `{{ site.baseurl }}` templated links excluded)
- `test/server/docs/agentSetClaims.spec.ts` and `doc-button-samples.spec.ts` pass
- the routes were read off `common/guiMcpAgents.ts`, `server/session/spawn-*.ts` and
  `common/customAgents.ts` rather than off the existing prose
