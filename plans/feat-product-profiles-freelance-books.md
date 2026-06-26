# Plan: Product Profiles + `freelance-books` (focused accounting product)

## Motivation

We want to ship a **focused product** — AI-native accounting for
freelancers / solo-entrepreneurs — without forking the host. The
capability already exists (accounting plugin + chart + document +
collections); what's missing is **focus, defaults, onboarding, and a
brand**.

The key insight: **capability ≠ product.** Integrating accounting into a
general host delivers capability. A product is capability **+ a curated
plugin set + a seeded workspace + a default role + branding + a first-run
flow + a name**. In open source the differentiation *can't* be secret
code (it's visible/forkable) — so the product layer **is** that
curation/config/content, deliberately separated from the general engine.

We already maintain two bespoke hosts (MulmoClaude, MulmoTerminal) that
share `packages/*`. A third hand-cloned host ("slim MulmoTerminal for
accounting") is the trap. The right move is to **teach the host to take a
Profile**, so a product becomes *data*, not a fork — the distro /
`create-app` model (Debian→Ubuntu, VS Code→VSCodium, webpack→CRA).

This converts a one-off into a generalizable platform capability —
consistent with the project's "generalizable declarative capability over
one-offs / self-improving agent" philosophy, applied at the *product*
layer.

## Two host *shells* — and which one freelance-books rides

MulmoClaude and MulmoTerminal are not just branding variants; they differ
in the **agent execution model**, which is a real axis, not a profile knob:

- **MulmoClaude** launches Claude Code **headless** (`claude -p`) — a
  GUI-first app that drives the agent via one-shot SDK invocations. The
  agent is "under the hood"; the user interacts with panels/buttons.
- **MulmoTerminal** launches Claude Code in a **real terminal emulator**
  (interactive PTY) — the actual Claude Code CLI is a first-class surface
  alongside the GUI panels. The user watches and steers the agent live.

**freelance-books rides the terminal-emulator shell (MulmoTerminal).**
The audience (freelancers / solo-entrepreneurs who already use Claude
Code) is terminal-native and will *prefer* the real CLI to a buttons-only
app. It also strengthens the core trust story: for high-stakes
bookkeeping, watching Claude Code do the work live in a terminal — with
full transparency and the ability to intervene mid-task — beats an opaque
"AI did it" panel. *Claude proposes in the terminal, you see every step,
the ledger is yours.*

Implication for the seam: the **profile + content are shell-agnostic**
(packages, collections, role, branding port to either shell); only the
*execution/presentation shell* differs. So the layering is:

```
shared capabilities (packages/*)  +  Profile (curation/content/branding)
        └── mounted on a host shell: headless (MulmoClaude) | terminal (MulmoTerminal)
```

freelance-books = the freelance Profile, mounted on the terminal shell.
Because the terminal shell is **MulmoTerminal (a separate repo consuming
the published `@mulmoclaude/*` packages)**, the seam work splits: this
repo keeps shipping the capability packages (accounting / collections /
chart / document) + ideally the Profile *schema* as a shared lib;
MulmoTerminal implements the Profile *runtime* (branding, plugin-manifest
curation, agent focus via a seeded CLAUDE.md + GUI-MCP tool set, landing
panels, workspace seeding) and the freelance launcher.

## What "focus" decomposes into — mapped to MulmoTerminal's actual seams

(Verified against `../mulmoterminal` — its architecture differs from
MulmoClaude's, so the seam differs too.)

| Concern | MulmoTerminal location | State |
|---|---|---|
| Which plugins are on | `plugins/plugins.json` (`{packages, servers, local}`) — drives BOTH `src/plugins-registry.ts` (Vue views) and `server/plugins-registry.ts` (MCP tools + dispatch) | **already a declarative manifest** |
| App name / brand | hardcoded `"MulmoTerminal"` across `src/*` (App.vue, composables, components) + `index.html` | hardcoded |
| Which tools the agent may use | **no role system** — the GUI-MCP tool set (from `plugins.json` → `GUI_MCP_TOOLS` / `--allowedTools`, `server/index.ts:1064`) + the cwd's `CLAUDE.md` (Claude Code reads it natively) | manifest + cwd content |
| Default workspace + landing | directory-based: `cwd-presets` (`{label,path}`, `server/cwd-presets.ts`, `~/.mulmoterminal/config.json`) + the default panel layout (`src/App.vue`) | per-user dirs |
| Seeded content | the chosen **cwd directory's contents** — `CLAUDE.md`, collection `schema.json`s, skills, sample data — on first open | not yet templated |
| Distribution | `bin/mulmoterminal.js` (`npx mulmoterminal`) | per-package |

Two consequences that reshape the seam vs. the MulmoClaude-centric sketch:
- **No `defaultRoleId`.** The agent is real Claude Code; "focus" = the
  GUI-MCP tool set (`plugins.json`) + a seeded **CLAUDE.md** in the
  workspace dir, not a role object.
- **The workspace is a directory.** "workspaceTemplate" = a *scaffolded
  cwd folder* (CLAUDE.md + schemas + skills + samples) surfaced as a
  default cwd-preset — not a fixed single workspace.

## Target shape

### The Profile seam (MulmoTerminal)

```ts
interface ProductProfile {
  id: string;                    // "freelance-books" | "mulmoterminal"
  branding: { appName: string; theme?: ThemeTokens; logo?: string };
  plugins: PluginsManifest;      // == plugins.json shape ({packages, servers, local})
  workspaceTemplate: string;     // ref to a scaffolded cwd folder (CLAUDE.md + schemas + skills + samples)
  defaultLanding?: PanelLayout;  // which GUI panels open by default around the terminal
  onboarding?: OnboardingStep[]; // first-run: pick / scaffold the business workspace
}
```

Touchpoints (read from the profile instead of literals):
- **plugins** → swap `plugins/plugins.json` (the manifest already exists — the cleanest knob).
- **branding** → parameterize the hardcoded `"MulmoTerminal"` strings (one source).
- **agent focus** → seed `CLAUDE.md` into the workspace dir; the GUI-MCP set follows from `plugins`.
- **workspace** → register the scaffolded folder as a default cwd-preset; seed on first run.
- **landing** → default panel layout in `App.vue`.

Dogfood: express MulmoTerminal's own default as a profile so the seam has ≥2 consumers.

### Integration gaps: accounting → MulmoTerminal (capability before focus)

MulmoTerminal does **not** depend on accounting yet, and the extraction
followed MulmoClaude's conventions — so plugging it in is more than a
`plugins.json` line. Three concrete gaps:

1. **Plugin-contract mismatch.** MulmoTerminal's registry expects each
   package to export a gui-chat-protocol `plugin` (`{ toolDefinition,
   execute }` + a `/vue` `viewComponent` keyed by toolName). Accounting's
   `/vue` exports `AccountingView` / `AccountingPreview` /
   `configureAccountingHost`, and its `manageAccounting` tool definition +
   passthrough `execute` live HOST-side in MulmoClaude. → accounting needs
   a gui-chat-protocol-compatible surface (a `plugin` export), or a thin
   adapter in MulmoTerminal.
2. **GUI-MCP exposure.** For the terminal agent to drive the books,
   `manageAccounting` must join `GUI_MCP_TOOLS` / `--allowedTools` via
   `server/plugins-registry.ts`. Falls out of (1) once accounting exports
   a normalized `{ definition, execute }`.
3. **Single-workspace DI vs multi-cwd.** Accounting's
   `configureAccountingServer({ workspaceRoot })` sets one global root;
   MulmoTerminal is multi-cwd (books live under `<cwd>/data/accounting`).
   For the **focused** freelance product this is a *feature*: pin ONE
   business workspace and the existing single-root DI works as-is. Generic
   accounting-in-MulmoTerminal would later need a per-request
   `workspaceRoot` resolver (the request already carries `cwd`).

### The `freelance-books` product (data on MulmoTerminal, not a fork)

- **Base = MulmoTerminal.** A `freelance-books` launcher boots
  MulmoTerminal with `profile=freelance-books`.
- Is: the Profile (branding + `plugins.json` incl. accounting / chart /
  markdown / collection + a seeded **CLAUDE.md** + default panels) + a
  **scaffolded workspace folder** (clients / worklogs / invoices
  `schema.json`s + the existing `mc-*` skills + sample data).
- Lives **in the MulmoTerminal repo** (tracks the terminal shell for
  free). The Profile *schema* + the workspace-template can ship as shared
  packages from *this* repo so both shells could consume them; earn a
  separate repo only if it gains independent release/community life.

## The product's actual core: the collection ↔ ledger bridge

(See the brainstorm — this is the value, not the four plugins.) Tracked
as its own workstream because it's load-bearing:

- **Boundaries:** invoice/worklog *records* live in collections; their
  *financial effect* (AR / revenue / cash) lives in the append-only
  journal. Linked, not duplicated — each invoice record carries the
  `postedEntryIds` it created.
- **Idempotency + edits:** re-running the bridge never double-posts;
  editing a posted invoice = void + re-post keyed off `postedEntryIds`
  (the journal is already append-only with void/reverse).
- **Trigger:** both a collection **action** ("Post to books") and an
  agent **skill** (`record-invoice` / `reconcile-payment`), writing the
  same idempotent link.
- **Trust surface:** an "unposted invoices / unreconciled payments"
  reconciliation view — the thing that proves collections and ledger
  agree.

Freelancer killer loop (the MVP demo): worklog → invoice (collection →
document/PDF) → AR entry → payment → cash receipt → live P&L / AR-aging
(chart) → month-end report (document).

## Staged plan

0. **Integrate accounting into MulmoTerminal (capability).** Close the
   three gaps above: give accounting a gui-chat-protocol `plugin` surface
   (or a MulmoTerminal adapter), add it to `plugins.json`
   (packages + servers) so its view registers and `manageAccounting`
   joins the GUI-MCP `--allowedTools`, and wire the server router with
   `configureAccountingServer` pinned to the session's `cwd`. ✅ gate:
   from the MulmoTerminal terminal, Claude can create a book + post an
   entry and the View renders it. (This is the "just integrate it" step —
   necessary but, alone, not a product.)
1. **Validate focus as a flag (no abstraction yet).** Add `--profile` /
   `MULMO_PROFILE=freelance` to MulmoTerminal: ship the curated
   `plugins.json` (accounting/chart/markdown/collection), a seeded
   workspace dir (CLAUDE.md focused on bookkeeping + the 3 collection
   schemas + `mc-*` skills + samples) as the default cwd-preset, and the
   default panel layout. Prove the focus + first-10-minutes with real
   users before building the seam. ✅ gate: a freelancer can go worklog →
   invoice → "who owes me?" unaided, steering from the terminal.
2. **Factor the Profile seam.** Promote the flag into the declarative
   `ProductProfile` (schema as a shared package from this repo; runtime
   in MulmoTerminal). Route branding / `plugins.json` / workspace-template
   / landing through it. Express MulmoTerminal's own default as a profile
   (dogfood). ✅ gate: zero behavior change for MulmoTerminal's default.
3. **Build the bridge.** Invoice/worklog ↔ ledger contract
   (`postedEntryIds`, void-on-edit), collection action + agent skills,
   reconciliation view. ✅ gate: the killer loop is idempotent end-to-end.
4. **Ship `freelance-books`.** Launcher (`bin`) + workspace-template +
   onboarding + branding, all in the MulmoTerminal repo. `npx
   freelance-books`. ✅ gate: clean first-run on an empty machine.
5. **Productize.** Invoice numbering / tax fields (pull JP T-number / EU
   VAT from the accounting book), CSV bank import → entries, PDF/CSV
   exports, tax-pack. Open-core monetization (hosted sync via Relay /
   premium skills) optional.

## Implementation notes (grounded against `../mulmoterminal`)

File:line anchors verified against the repo so implementers don't have to
re-discover the seams. Two findings below **correct** the higher-level
sketch above — read them before Stage 1.

### Seam reference (verified)

| Seam | File | Anchor | Shape / logic |
|---|---|---|---|
| Plugin manifest | `plugins/plugins.json` | 1–12 | `{ packages[], servers[], local[] }` |
| Frontend registry | `src/plugins-registry.ts` | `PACKAGES` dict 44–103; loop 110–124; `getPlugin(toolName)` 126–128 | **static** dict keyed by pkg name → `Registration { toolName, viewComponent, css?, height? }` |
| Server registry | `server/plugins-registry.ts` | `loadConfig()` 51–59; parallel load 150–154; `allowedToolNames()` 187–189 | normalizes to `{ toolName, definition, execute }`; MCP names = `mcp__mulmoterminal-gui__<toolName>` |
| GUI-MCP allowlist | `server/index.ts` | `GUI_MCP_TOOLS` 165 (imports `allowedToolNames` 14) → `buildClaudeArgs` 1056–1066 → `server/claude-args.ts:26` pushes `--allowedTools` | comma-joined fully-qualified tool names |
| cwd-presets | `server/cwd-presets.ts` | `CwdPreset { label, path }` 6–9; `loadPresets`/`savePresets` 25–44 | per-user dirs |
| App config | `server/app-config.ts` / `server/config-routes.ts` | `AppConfig { cwdPresets[], soundFile }` 9–14; file `~/.mulmoterminal/config.json`; GET/POST `/api/config` 17–48 | loaded once at module init |
| Branding (user-facing) | `src/App.vue:206`, `src/components/GridView.vue:111`, `index.html:7`, `bin/mulmoterminal.js:130` | — | only **4** user-visible literals; the rest are comments |
| Panel layout | `src/App.vue` | view-mode 23–27; terminal width 71–73; session layout 154; tools pane 162 | defaults: single view, 560px terminal, vertical sidebar, tools hidden — all `localStorage`-persisted |
| Distribution | `bin/mulmoterminal.js` | `main()` 228–301; `runServer()` 191–226; spawns `tsx server/index.ts` | pre-flight `claude --version`; port bind-retry (exit 75) |
| Plugin contract | `node_modules/gui-chat-protocol/dist/vue.d.ts` | — | core exports `TOOL_DEFINITION` + `pluginCore`; `./vue` exports `plugin` (adds `viewComponent`, `previewComponent`) |

### Correction 1 — the frontend is NOT manifest-driven

`plugins.json` only gates the **server** dynamically. The Vue side
(`src/plugins-registry.ts:44–103`) resolves each package name through a
**hardcoded `PACKAGES` dict** (static `import` + `?inline` css). So
"swap `plugins.json`" is necessary but **not sufficient**: a package the
profile turns on must already have an entry in that dict, or its view
won't render. Two consequences:
- Stage 0 (accounting) must add an `AccountingView` entry to `PACKAGES`,
  not just a `plugins.json` line.
- Stage 2's Profile seam, to be honestly data-driven on the frontend,
  must either (a) make `PACKAGES` a superset registry that the profile
  *filters*, or (b) move to dynamic `import()`. (a) is the smaller,
  Vite-friendly move — every supported plugin stays statically importable;
  the profile just selects which `Registration`s are live. Note this in
  Stage 2's gate.

### Correction 2 — accounting is entirely absent today

There is **no** `@mulmoclaude/accounting` anywhere in `../mulmoterminal`
(not in `plugins.json`, `node_modules`, or any grep hit). Stage 0 is
greenfield wiring, not a re-point. The contract it must satisfy is the
`gui-chat-protocol` `ToolPluginCore` (above): export `TOOL_DEFINITION` +
`pluginCore` from the core entry and `plugin` (with `viewComponent`) from
`./vue`. Since accounting's tool def + passthrough `execute` currently
live HOST-side in MulmoClaude, Stage 0 gap 1 = publish that normalized
surface from the package (preferred, reusable by both shells) **or** write
a thin adapter module under `plugins/` `local`.

### Stage-by-stage build notes

**Stage 0 — integrate accounting (capability).**
1. Give `@mulmoclaude/accounting` (or a `plugins/local/accounting` adapter)
   a `gui-chat-protocol` surface: `TOOL_DEFINITION` (`manageAccounting`) +
   `pluginCore.execute` + `./vue` `plugin.viewComponent = AccountingView`.
2. Add it to `plugins.json` `packages` (server picks up `definition` +
   `execute` and `manageAccounting` auto-joins `allowedToolNames()` →
   `--allowedTools`).
3. Add an `AccountingView` entry to `src/plugins-registry.ts:PACKAGES`
   (per Correction 1).
4. Pin the workspace root: call `configureAccountingServer({ workspaceRoot })`
   with the session `cwd` at server init. Single-root DI is fine for the
   focused product; a per-request `cwd` resolver is deferred (the request
   already carries `cwd`).
   ✅ gate: from the terminal, Claude creates a book + posts an entry and
   the View renders it.

**Stage 1 — focus as a flag (no abstraction).**
- Add `--profile` / `MULMO_PROFILE=freelance` parsing to
  `bin/mulmoterminal.js` (`main()` arg parse ~263) and thread it to the
  server env (alongside `CLAUDE_CWD` at `runServer()` ~196).
- Ship a curated `plugins.json` (accounting/chart/markdown/collection).
- Scaffold a workspace dir (CLAUDE.md focused on bookkeeping + 3
  collection `schema.json`s + `mc-*` skills + samples) and register it as
  the default `cwd-preset` (seed into `~/.mulmoterminal/config.json`
  `cwdPresets` on first run if absent).
- Default panel layout via the `App.vue` `localStorage` defaults (or a
  query/env seed so a fresh profile opens GUI panels, not just terminal).
  ✅ gate: a freelancer goes worklog → invoice → "who owes me?" unaided.

**Stage 2 — factor the Profile seam.**
- `ProductProfile` **schema** ships from *this* repo as a shared package;
  **runtime** lives in MulmoTerminal.
- Route the 4 user-facing branding literals (table above) through
  `profile.branding.appName`.
- Resolve `plugins.json` from `profile.plugins`; filter the frontend
  `PACKAGES` superset by it (Correction 1a).
- Default cwd-preset + landing from the profile.
- Dogfood: express MulmoTerminal's own default as `profile=mulmoterminal`.
  ✅ gate: **zero** behavior change for the default profile (snapshot the
  current `plugins.json`, branding, and panel defaults; diff to prove it).

**Stages 3–5** unchanged in shape; the bridge (Stage 3) remains the
load-bearing design risk — see the dedicated workstream above. **Suggest
spiking the idempotent `postedEntryIds` link before Stage 1 lands**, since
it is the only piece with real design risk; everything in 0–2 is plumbing.

## Constraints / principles

- **No engine fork.** Every product is config + content over an
  unchanged general host. If something can't be expressed as profile
  data, that's a signal to widen the seam — not to fork.
- **Upstream stays general & OSS.** Profiles track upstream; differentiation
  is curation / defaults / onboarding / brand / hosted layer.
- **Single source of truth across the bridge.** Collections own
  operational docs; the journal owns money; the link is explicit + idempotent.
- **Trust is the product.** "Claude proposes, you approve, the ledger is
  yours (plain files + git = audit trail)." Make approval first-class;
  position as bookkeeping + reporting, NOT tax filing/advice, at launch.

## Risks / watch-outs

- **Don't build the platform before the product.** Stage 1 is a flag, not
  the seam — validate focus first.
- **Collection/ledger drift** is how these systems rot; the reconciliation
  view + idempotent link are mandatory, not nice-to-have.
- **Single-currency-per-book** limits cross-border freelancers — known gap.
- **Audience size:** the freelancer slice is real but niche; the
  plain-text-accounting crowd (beancount / ledger / hledger) is the
  beachhead — consider import/export interop for credibility.
- **Compliance liability** (invoice numbering, retention, tax) — scope to
  bookkeeping at launch; country-aware advice stays advisory.

## Locked decisions

- **Base shell = MulmoTerminal (terminal emulator)**, not the headless
  `-p` shell — the audience is terminal-native and live transparency
  reinforces trust.

## Open decisions

1. **Product name** (working title `freelance-books`).
2. **Profile-runtime location** — beside MulmoTerminal (recommended:
   tracks the terminal shell for free) vs a separate repo. Profile
   *schema* + workspace-template ship as shared packages from this repo
   regardless.
3. **Beancount/ledger interop** in scope? (cheap credibility for the
   beachhead.)
4. **MVP loop:** invoice loop (worklog→paid, daily pain) vs CSV→books
   (tax prep). Recommend the invoice loop — exercises all four pieces.
5. **Monetization:** pure OSS vs open-core (hosted sync / tax packs /
   multi-entity).
6. **Does MulmoClaude (headless) also adopt the Profile seam**, or does
   the seam stay terminal-only for now? (Dogfooding ≥2 consumers keeps it
   honest, but isn't required to ship freelance-books.)
