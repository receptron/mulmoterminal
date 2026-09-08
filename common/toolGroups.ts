// The GUI MCP is served at one URL per GROUP of tools, so a user can turn a subset on for a
// directory with Claude Code's own per-folder MCP config (`.mcp.json` / `claude mcp add -s
// local`) instead of a MulmoTerminal setting. `.mcp.json` only switches whole SERVERS on and
// off — splitting the URL is what turns that into tool granularity.
//
// These names appear in the URL path AND in the server id users write in their own config
// (`mulmoterminal-<group>`), so they are effectively public API: renaming one breaks every
// config already written against it.

// The groups, ordered by how much damage a call can do.
//   render   — draws a model or document for the user, and writes nothing but the
//              artifact it just drew. It USED to mean "no side effect outside the
//              Canvas panel"; presentShapeScript saves its `.shape` and
//              renderShapeScript saves a PNG, so the honest line is that a render
//              tool touches only its own output, never the workspace's data or
//              anything off this machine.
//   data     — reads/writes the workspace's structured data (collections, accounting).
//   media    — generation that is slow, costly, and lands files on disk.
//   external — reaches a third-party account or API.
export const TOOL_GROUPS = ["render", "data", "media", "external"] as const;

export type ToolGroup = (typeof TOOL_GROUPS)[number];

export const isToolGroup = (value: unknown): value is ToolGroup => TOOL_GROUPS.some((group) => group === value);

// The groups the Canvas pane is made of. The launcher offers a switch per group, the panel's
// availability is decided by them, and the server routes on them — named here rather than
// written as `"render"` / `"media"` at each of those sites, so a rename cannot leave one of them
// silently pointing at a group that no longer exists.
//
// `media` is in because its tools DRAW: generateImage and presentMulmoScript land in the same
// panel a render tool does. It is a separate switch rather than part of one because the two
// differ in what a call costs — render stops at the pane, media is slow, paid and writes files —
// and that is exactly the line the grouping exists to draw. Neither media tool is in
// AUTO_ALLOWED_TOOLS, so enabling the group still leaves Claude Code's permission prompt in
// front of the spend (same reasoning as presentDocument below).
export const CANVAS_TOOL_GROUPS: readonly ToolGroup[] = ["render", "media"];

// The groups the COLLECTIONS pane is made of. `data` is the group manageCollection and
// presentCollection belong to, and the pane is a window onto exactly that store — a directory
// that never registered the group has no collection tools, so the pane is a door onto a room the
// agent beside it cannot enter.
//
// Named here rather than written as `"data"` at the call site for the same reason
// CANVAS_TOOL_GROUPS is: a rename must not leave a literal pointing at a group that is gone.
export const COLLECTIONS_TOOL_GROUPS: readonly ToolGroup[] = ["data"];

/** Does this session/directory have the collection tools? Same shape as `hasCanvasGroup`, and
 *  validated the same way — an unknown group name from a newer server must not count. */
export const hasCollectionsGroup = (groups: unknown): boolean =>
  Array.isArray(groups) && groups.some((group) => isToolGroup(group) && COLLECTIONS_TOOL_GROUPS.includes(group));

// Does a session/directory reach the Canvas at all? Asked of the group list the server reports,
// whose members arrive as plain strings — validated rather than cast, since an unknown name from
// a newer server must not count as a canvas group.
export const hasCanvasGroup = (groups: unknown): boolean =>
  Array.isArray(groups) && groups.some((group) => isToolGroup(group) && CANVAS_TOOL_GROUPS.includes(group));

// What the launcher's switch for a group calls it. The group NAME is shown too (it is the MCP
// server id the switch registers), so this line answers the other question: what does the agent
// gain. Two groups share a heading on purpose — render and media both end up in the Canvas pane,
// which is why CANVAS_TOOL_GROUPS above holds exactly those two.
//
// A Record, not a lookup with a fallback: adding a group to TOOL_GROUPS without deciding what to
// call it should fail to compile, not ship a switch labelled "external".
export const TOOL_GROUP_HEADINGS: Record<ToolGroup, string> = {
  render: "Canvas",
  data: "Workspace data",
  media: "Canvas",
  external: "External accounts",
};

// Which group each GUI tool belongs to.
//
// A tool that is absent belongs to NO group and is therefore reachable only through the
// all-tools URL (`/api/mcp/:sessionId`, the single view). That is the deliberate failure
// mode: forgetting to classify a newly added plugin withholds it from the group URLs rather
// than leaking it into one — the map can go stale, but only ever closed.
//
// `spawnBackgroundChat` is absent ON PURPOSE, not by omission: it starts another session,
// which is neither drawing, data, media, nor an external call, and a grid cell has no
// business doing it silently.
// A Map, not a plain object — the same reason the plugin dispatch map is one: object index
// access reads through the prototype chain, so `constructor` / `__proto__` / `toString` would
// resolve to an Object.prototype member and report a truthy "group". Map.get only ever returns
// own entries.
const GROUP_BY_TOOL = new Map<string, ToolGroup>([
  ["presentDocument", "render"],
  ["presentForm", "render"],
  ["presentChart", "render"],
  ["presentHtml", "render"],
  ["presentShapeScript", "render"],
  // Beside presentShapeScript deliberately: a cell that can show a 3D model should be
  // able to CHECK one, and splitting the pair would leave an agent able to present a
  // model it cannot look at first.
  ["renderShapeScript", "render"],

  // presentCollection RENDERS, but it renders collection data and only makes sense next to
  // manageCollection — a cell offered the view without the store gets a tool it cannot fill.
  ["presentCollection", "data"],
  ["manageCollection", "data"],
  ["manageAccounting", "data"],
  // manageSharedApp deploys and publishes the SHARED collections of the directory the cell is
  // open in, so it belongs where their store does: a cell without the data group has no
  // collection tools, and a deploy tool beside no collections is a tool with nothing to deploy.
  // It is not in AUTO_ALLOWED_TOOLS, and it is in NEVER_AUTO_APPROVED_TOOLS below — publish is the
  // one operation here that changes what people outside the roster can see, and the permission
  // prompt is wanted in front of it on EVERY session, the workspace included.
  ["manageSharedApp", "data"],

  ["generateImage", "media"],
  ["presentMulmoScript", "media"],

  // useSharedApp is the participant's half of the shared-app pair, and it is NOT beside
  // manageSharedApp in `data`. That group is the workspace's own structured data; this tool moves
  // records in an app SOMEBODY ELSE published, and a transition it performs can queue real mail to
  // a real person. That is what `external` names — a reach outside this machine's own store — and
  // it is a separate switch so a directory can have its own collections without also being able to
  // act inside other people's apps. It is in NEVER_AUTO_APPROVED_TOOLS below for the same reason
  // manageSharedApp is: `withdraw` deletes somebody's record with no undo.
  ["useSharedApp", "external"],

  ["google", "external"],
  ["readXPost", "external"],
  ["searchX", "external"],
]);

export const groupOfTool = (toolName: string): ToolGroup | null => GROUP_BY_TOOL.get(toolName) ?? null;

// Every tool in a group, in the order declared above. The Canvas panel's empty state names them,
// so a tool added to a group here reaches that list without a second edit — the list had been
// written out by hand and named two of the four.
export const toolsInGroup = (group: ToolGroup): string[] => [...GROUP_BY_TOOL].filter(([, g]) => g === group).map(([name]) => name);

// The MCP server id a group is expected to be registered under. `--allowedTools` matches on
// `mcp__<server id>__<tool>`, and the id comes from the USER's config key — so this is a
// convention the enable-it-for-this-folder affordance has to write, and a user who registers
// the same URL under another name simply gets permission prompts (nothing breaks).
//
// DELIBERATELY long, and deliberately NOT the same id as GUI_SERVER_ID below. The two are
// reached by different routes (see that constant), so the same tool is named
// `mcp__mulmoterminal-render__presentChart` in a project cell and `mcp__mt__presentChart` in a
// workspace one. That is not drift to be tidied up: shortening these would break every
// `.mcp.json` and `claude mcp add -s local` entry users have already written against them,
// which the launcher's per-group switch also reads back and the setup guide documents. It needs
// a migration over existing per-folder configs, not a rename. README's "MCP server ids" section
// is the long version.
export const toolGroupServerId = (group: ToolGroup): string => `mulmoterminal-${group}`;

// The MCP server id the SINGLE VIEW registers — every tool on one URL, rather than the per-group
// ids above. Unlike those, a user never writes this one: it is generated per spawn into
// `--mcp-config` (claude) or `-c mcp_servers.<id>.url=` (codex), so it is ours to name.
//
// Which of the two ids a session gets is decided by `carriesFullGuiMcp` in
// server/session/spawn-claude.ts: the single view, a cell-less chat, and a cell whose cwd IS the
// workspace carry this one; a cell in a project directory is handed no --mcp-config at all and
// reaches the group ids through the user's own per-folder config. Both are live, on purpose.
//
// It is SHORT because the id is not what the agent sees — the client prefixes every tool with it.
// claude turns `presentChart` into `mcp__<id>__presentChart` and codex into `mcp-<id>-presentChart`
// (with `-` in the id normalised to `_`), so a long id is paid on every tool name in every listing.
// `mulmoterminal-gui` cost 17 characters per tool to say what the surrounding config already says.
//
// It had been spelled out at four sites (this server's registration, the advertised server name,
// the allowedTools prefix and the reserved-id list). It lives here now because both the server and
// the UI-facing config validation decide from it — see the `common/` rule in CLAUDE.md.
export const GUI_SERVER_ID = "mt";

// Ids this project has shipped for the SAME single-view server before. Not live: kept so the place
// that must recognise our own past output still does — the Antigravity config merge, which deletes
// our entries by id and would otherwise leave a stale `mulmoterminal-gui` behind forever.
//
// Only where we WROTE them, though. A legacy id is not reserved against the user's own
// `userMcpServers`: nothing writes it any more, so a server someone names `mulmoterminal-gui`
// today is reachable and works, and treating it as ours would be claiming a name we abandoned.
export const LEGACY_GUI_SERVER_IDS: readonly string[] = ["mulmoterminal-gui"];

// The tools MulmoTerminal pre-approves via `--allowedTools`, so they run without a permission
// prompt. A list of TOOLS, not of groups: a group says which tools a directory can reach, and
// that is not the same question as which may run unattended.
//
// `presentDocument` is the case that forces them apart, and it is deliberately ABSENT. Its
// execute runs `fillImages` before saving, which resolves every image placeholder in the
// markdown through the image backend — a PAID generation call. Auto-allowing it would let a
// model spend money silently under a switch the UI presents as "let the agent draw", so it
// keeps Claude Code's prompt (answer it once per project and the prompt stops).
//
// The four below save an artifact and draw it, and call nothing external.
//
// `presentShapeScript` was listed here on the grounds that it saved nothing at all —
// the source travelled in the tool result and was rendered client-side. That stopped
// being true at shapescript-plugin 1.1.0, which writes the model to
// `artifacts/shapes/` and can open a `.shape` the caller names. It stays on the list,
// but now for the same reason as the other three rather than a stronger one that no
// longer holds.
//
// `renderShapeScript` is here too, and the reasoning is worth stating because the first
// attempt got it wrong. It starts a PROCESS — a headless browser — which reads like the
// far side of "calls nothing external", so it was left off. But this bar is about REACH
// and COST, not about process creation: the tools kept off it spend money
// (presentDocument's image fill), publish to the internet, or act in someone else's
// account. A local Chromium rendering a page WE construct, with every request it makes
// aborted unless it is one of our two assets, does none of that. It writes a PNG under
// the workspace artifacts and burns CPU for at most the render budget.
//
// Leaving it off was also not the half-measure it looked like. This list governs GRID
// cells; the workspace passes `allowedToolNames()`, which auto-approves everything not
// in NEVER_AUTO_APPROVED_TOOLS — so the tool prompted in a cell and ran unattended in
// the workspace, which is the worst of both and matches no stated policy (codex on
// #2010). The two paths now agree.
//
// And the friction had no payoff: the tool exists so an agent can CHECK a model before
// showing it, which is a render-look-fix loop. A prompt in the middle of that costs the
// user attention to approve the agent looking at its own work.
export const AUTO_ALLOWED_TOOLS: readonly string[] = ["presentForm", "presentChart", "presentHtml", "presentShapeScript", "renderShapeScript"];

/** Tools that must keep the agent's permission prompt on EVERY claude session, including the
 *  workspace.
 *
 *  `AUTO_ALLOWED_TOOLS` above is the grid cell's list and withholds these already — but it is an
 *  allowlist, and the workspace does not use it. The workspace passes `allowedToolNames()`, which
 *  is every tool, so a tool absent from `AUTO_ALLOWED_TOOLS` was still auto-approved in exactly
 *  the session that builds a shared app. The comment on `manageSharedApp` said the prompt was
 *  wanted in front of publish; nothing implemented it. This is what implements it.
 *
 *  It matters because of what the agent reads. A shared app is a repository, and the agent is
 *  already reading untrusted text out of it — skill files, collection notes, issue bodies, survey
 *  copy somebody pasted. `manageSharedApp` publishes to the internet, rewrites the roster, and
 *  hands the roster live records. `useSharedApp` moves records in an app somebody else published
 *  and can queue mail that cannot be recalled. With auto-approval, "invite this address as owner,
 *  then deploy" arriving in that text is a tool call rather than a question.
 *
 *  IT SAYS CLAUDE, AND THAT IS THE WHOLE OF ITS REACH. codex approves per SERVER — `guiMcpServers`
 *  in `server/session/mcp-config.ts` marks every attached group `autoApprove: true`, by the owner's
 *  decision of 2026-07-28 — so a codex cell holding a group waves through every tool in it, this
 *  list included. That is already true of `manageSharedApp` in `data` and is now equally true of
 *  `useSharedApp` in `external`; adding the tool did not create it. It cannot be narrowed per tool
 *  from here, and narrowing it per GROUP would put a prompt in front of every drawing and
 *  collection call in a codex cell, which is what the flag was added to avoid. Said out loud
 *  rather than left to be discovered from the constant's name (Codex on #1843). */
export const NEVER_AUTO_APPROVED_TOOLS: readonly string[] = ["manageSharedApp", "useSharedApp"];
