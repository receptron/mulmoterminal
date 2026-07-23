// The tools pane's server side: where a plugin's rendered result is stored, and how the
// pane replays results and call history for a session. The stores arrive as a parameter —
// they are one instance owned by index.ts, and two would each keep their own in-memory
// copy of the same sessions.
import type { Express } from "express";
import { SESSION_ID_RE } from "../config/env.js";
import type { createToolStores } from "../session/tool-store.js";
import { planToolResultUpdate } from "./toolResultPlan.js";

export interface ToolRouteDeps {
  stores: ReturnType<typeof createToolStores>;
  /** The GUI plugin tools this server exposes, for the pane's "Available Tools" list. */
  toolSummaries: unknown;
  publish: (channel: string, data: unknown) => void;
  sessionChannel: (id: string) => string;
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

  // The GUI plugin tools available this session (for the tools pane's "Available
  // Tools" list). The full set claude can call — built-ins, other MCP — is not
  // enumerable server-side; those still show up in the tool-call history below.
  app.get("/api/tools", (_req, res) => {
    res.json({ tools: deps.toolSummaries });
  });

  // Replay a session's tool-call history (every tool, via the Pre/PostToolUse hooks)
  // so the tools pane can render it when the user (re)selects that session. Loads
  // from disk (~/.mulmoterminal/toolcalls) on first access so it survives a reboot.
  app.get("/api/tool-calls/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    if (!SESSION_ID_RE.test(sessionId)) return res.status(400).json({ error: "invalid sessionId" });
    res.json({ sessionId, toolCalls: await deps.stores.toolCallsStore.get(sessionId) });
  });
}
