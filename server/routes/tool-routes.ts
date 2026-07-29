// The tools pane's server side: where a plugin's rendered result is stored, and how the
// pane replays results and call history for a session. The stores arrive as a parameter —
// they are one instance owned by index.ts, and two would each keep their own in-memory
// copy of the same sessions.
import type { Express } from "express";
import { SESSION_ID_RE } from "../config/env.js";
import type { createToolStores } from "../session/tool-store.js";
import { planToolResultUpdate } from "./toolResultPlan.js";
import { groupOfTool, type ToolGroup } from "../../common/toolGroups.js";

export interface ToolSummary {
  toolName: string;
  title: string;
  description?: string;
}

export interface ToolRouteDeps {
  stores: ReturnType<typeof createToolStores>;
  /** The GUI plugin tools this server exposes, for the pane's "Available Tools" list. */
  toolSummaries: ToolSummary[];
  /** Which tool groups a session actually reached us on — see session/session-tool-groups.ts. */
  sessionToolGroups: (sessionId: string) => ToolGroup[];
  sessionToolGroupsHydrated: Promise<void>;
  /**
   * Is this a GRID cell? The two kinds of session get their GUI tools by different routes, and
   * "no groups learned" means the opposite thing for each — see narrowedTools.
   */
  isGridSession: (sessionId: string) => boolean;
  devTerminalSessionsHydrated: Promise<void>;
  /**
   * Is this session's tool-call history fed by the MCP broker rather than by hooks — i.e. does it
   * hold the GUI tools ALONE? The pane says so, because an empty GUI-only history looks exactly
   * like an agent that ran nothing. Answered server-side because the client cannot work it out:
   * a codex launcher chip is a cell with no agent name on it (see mcp/gui-call-history.ts).
   */
  guiOnlyHistory: (sessionId: string) => boolean;
  publish: (channel: string, data: unknown) => void;
  sessionChannel: (id: string) => string;
}

// An UNGROUPED tool (spawnBackgroundChat) belongs to no group URL, so it cannot have reached a
// grid cell — it is listed only for a session we did not narrow at all.
const hasGroup = (group: ToolGroup | null, groups: readonly ToolGroup[]): boolean => group !== null && groups.includes(group);

/**
 * The tools a session actually has.
 *
 * The rule that matters: an EMPTY group list means opposite things for the two kinds of session,
 * and conflating them is what let a grid cell with no MCP registered report every tool — and so
 * offer a Canvas button that opened a panel nothing could ever fill.
 *
 *   single view — carries the whole GUI MCP on --mcp-config and never connects to a group URL,
 *                 so it learns no groups and nonetheless has everything.
 *   grid cell   — has exactly what its directory registered with Claude Code. Nothing
 *                 registered, nothing learned, nothing available.
 */
export function narrowedTools(tools: readonly ToolSummary[], groups: readonly ToolGroup[], isGrid: boolean): ToolSummary[] {
  if (!isGrid) return [...tools];
  return tools.filter((tool) => hasGroup(groupOfTool(tool.toolName), groups));
}

export function mountToolRoutes(app: Express, deps: ToolRouteDeps): void {
  // The GUI toolResult sink. Two callers POST here:
  //   - the MCP broker, after a plugin produces a result (data gates rendering);
  //   - the GUI panel, to persist a plugin view's state change (e.g. a submitted
  //     form's viewState) under the same uuid.
  // We store the result keyed by session id and publish it on that session's channel
  // so the active panel renders/updates it live. Mirrors MulmoClaude's internal
  // toolResult route + applyToolResultToSession.
  app.post("/api/agent/toolResult", async (req, res) => {
    const plan = planToolResultUpdate(req.body);
    if (!plan.ok) {
      return res.status(400).json({ error: plan.error });
    }
    await deps.stores.storeToolResult(plan.sessionId, plan.stored);

    if (plan.publish) {
      deps.publish(deps.sessionChannel(plan.sessionId), plan.stored);
      console.log(`[gui] toolResult ${plan.toolName} for ${plan.sessionId}`);
    }
    res.json({ ok: true });
  });

  // Replay a session's stored toolResults so the panel can render them when the
  // user (re)selects that session. Loads from disk (~/.mulmoterminal/toolresults) on
  // first access so the views survive a reboot.
  app.get("/api/agent/toolResults/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    if (!SESSION_ID_RE.test(sessionId)) return res.status(400).json({ error: "invalid sessionId" });
    res.json({ sessionId, toolResults: await deps.stores.toolResultsStore.get(sessionId) });
  });

  // The GUI plugin tools, for the tools pane's "Available Tools" list. The full set claude
  // can call — built-ins, other MCP — is not enumerable server-side; those still show up in
  // the tool-call history below.
  //
  // `?sessionId=` narrows it to what THAT session actually has. It is no longer the same for
  // every session: a grid cell reaches the GUI tools through one URL per group, registered in
  // the user's own per-folder MCP config, so two cells can differ. Without the parameter the
  // answer stays the whole set (the single view, which carries every tool).
  app.get("/api/tools", async (req, res) => {
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : null;
    // With no session there is no history to describe either, so the flag stays false rather than
    // disclaiming a pane that is showing nobody's history.
    if (sessionId === null || !SESSION_ID_RE.test(sessionId)) return res.json({ tools: deps.toolSummaries, guiOnlyHistory: false });
    // Both sets are persisted and hydrated at boot; asked before either resolves, a grid cell
    // would read as having nothing and a resumed one as having lost its groups.
    await Promise.all([deps.sessionToolGroupsHydrated, deps.devTerminalSessionsHydrated]);
    const groups = deps.sessionToolGroups(sessionId);
    const isGrid = deps.isGridSession(sessionId);
    res.json({ tools: narrowedTools(deps.toolSummaries, groups, isGrid), groups, guiOnlyHistory: deps.guiOnlyHistory(sessionId) });
  });

  // Replay a session's tool-call history — every tool for claude (its Pre/PostToolUse hooks),
  // the GUI tools alone for codex / agy (the broker; they have no hooks) — so the tools pane
  // can render it when the user (re)selects that session. Loads
  // from disk (~/.mulmoterminal/toolcalls) on first access so it survives a reboot.
  app.get("/api/tool-calls/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    if (!SESSION_ID_RE.test(sessionId)) return res.status(400).json({ error: "invalid sessionId" });
    res.json({ sessionId, toolCalls: await deps.stores.toolCallsStore.get(sessionId) });
  });
}
