// The GUI MCP is served at one URL per GROUP of tools, so a user can turn a subset on for a
// directory with Claude Code's own per-folder MCP config (`.mcp.json` / `claude mcp add -s
// local`) instead of a MulmoTerminal setting. `.mcp.json` only switches whole SERVERS on and
// off — splitting the URL is what turns that into tool granularity.
//
// These names appear in the URL path AND in the server id users write in their own config
// (`mulmoterminal-<group>`), so they are effectively public API: renaming one breaks every
// config already written against it.

// The groups, ordered by how much damage a call can do.
//   render   — draws into the Canvas panel and stops there. No side effect outside it.
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

// Does a session/directory reach the Canvas at all? Asked of the group list the server reports,
// whose members arrive as plain strings — validated rather than cast, since an unknown name from
// a newer server must not count as a canvas group.
export const hasCanvasGroup = (groups: unknown): boolean =>
  Array.isArray(groups) && groups.some((group) => isToolGroup(group) && CANVAS_TOOL_GROUPS.includes(group));

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

  // presentCollection RENDERS, but it renders collection data and only makes sense next to
  // manageCollection — a cell offered the view without the store gets a tool it cannot fill.
  ["presentCollection", "data"],
  ["manageCollection", "data"],
  ["manageAccounting", "data"],

  ["generateImage", "media"],
  ["presentMulmoScript", "media"],

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
export const toolGroupServerId = (group: ToolGroup): string => `mulmoterminal-${group}`;

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
// The three below save an artifact and draw it, and call nothing external.
export const AUTO_ALLOWED_TOOLS: readonly string[] = ["presentForm", "presentChart", "presentHtml"];
