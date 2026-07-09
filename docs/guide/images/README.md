# Guide screenshots

Captured from a **throwaway demo instance** (a fresh `HOME`, empty config seeded with neutral demo data
— `acme-web` / `acme-api`, `Shell` / `Node REPL` launchers), so no personal session data appears. Retina
(`deviceScaleFactor: 2`), 1440×900 viewport.

| File | Shows |
|---|---|
| `single-view.png` | The single view (chat + GUI panel) |
| `grid-launch-form.png` | An empty grid cell's launcher form (dir / Claude·Codex / worktree / launch commands) |
| `grid-one-cell.png` | One running cell — the two-row header, git chip, `connected` |
| `grid-two-cells.png` | Two parallel terminals |
| `grid-2x2.png` | Four parallel terminals (2×2) |
| `grid-zoom.png` | Expanded cell + filmstrip thumbnails |
| `settings.png` | The Settings modal (theme / sound / PR repos / launch commands / MCP) |
| `grid-colors.png` | Four projects color-coded via per-dir `.mulmoterminal.json` (Mondrian / Van Gogh / Picasso / Matisse). Real Claude cells in throwaway `/tmp` demo repos on untrusted dirs (so the trust prompt shows, no account/email leaks). |

## Not yet captured (need a live Claude/Codex session)

These states need a real agent turn (cost/time) to look right, so they aren't referenced in the guide yet.
Capture from the demo instance while a Claude session runs, then add them:

- Working / needs-attention status colors on a cell.
- The model / context badge (`Opus · ctx 35%`).
- A worktree cell's diff badge + diff panel.
- The activity timeline (🕘) modal.
- The estimated-cost block in Settings.
