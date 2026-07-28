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

// The MCP server id a group is expected to be registered under. `--allowedTools` matches on
// `mcp__<server id>__<tool>`, and the id comes from the USER's config key — so this is a
// convention the enable-it-for-this-folder affordance has to write, and a user who registers
// the same URL under another name simply gets permission prompts (nothing breaks).
export const toolGroupServerId = (group: ToolGroup): string => `mulmoterminal-${group}`;

// Groups whose tools MulmoTerminal pre-approves via `--allowedTools`, so they run without a
// permission prompt. Only `render`: it cannot touch anything outside the Canvas panel, so
// silent execution is the point. Everything else goes through Claude Code's normal prompt —
// which is the whole reason the groups are split by blast radius above.
export const AUTO_ALLOWED_TOOL_GROUPS: readonly ToolGroup[] = ["render"];
