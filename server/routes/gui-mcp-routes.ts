// Turning a directory's GUI tool groups on and off. Its own module rather than another
// /api/dir-* route: those all READ something about a directory from files we own, while these
// two read and WRITE Claude Code's own MCP config by shelling out to its CLI.
import type { Express } from "express";
import { existingWorkspace, existingWorkspaceFromQuery } from "../config/workspace.js";
import { claudeAdapter } from "../agents/claude.js";
import { TOOL_GROUPS, isToolGroup } from "../../common/toolGroups.js";
import { registerGuiMcpGroup, unregisterGuiMcpGroup, registeredGuiMcpGroups } from "../infra/gui-mcp-registration.js";

export function mountGuiMcpRoutes(app: Express): void {
  // Which GUI tool groups this directory has registered with Claude Code, so the launcher can
  // show the Canvas switch in the right position. Read back from `claude mcp list` per request
  // rather than remembered — the user can add or remove one with the CLI behind our back.
  //
  // Same no-fallback rule as /api/dir-config-detail: this REPORTS ON the directory it was asked
  // about, and answering about the default workspace under another directory's name is worse
  // than answering "unknown".
  app.get("/api/gui-mcp-groups", (req, res) => {
    const cwd = existingWorkspaceFromQuery(req.query.cwd);
    if (!cwd) return res.json({ groups: [] });
    res.json({ groups: registeredGuiMcpGroups(claudeAdapter.bin(), cwd, TOOL_GROUPS) });
  });

  // Turn a group on or off for this directory. Writes through `claude mcp` into LOCAL scope —
  // the user's own file, keyed by the directory — so MulmoTerminal stores nothing of its own
  // and `claude mcp list` stays the one place the registration can be seen.
  //
  // It takes effect on the cell's NEXT start: the tools are handed to claude when the session
  // spawns, so a session already running keeps whatever it was given.
  app.post("/api/gui-mcp-groups", (req, res) => {
    const cwd = existingWorkspace(typeof req.body?.cwd === "string" ? req.body.cwd : null);
    const { group, enabled } = req.body ?? {};
    if (!cwd) return res.status(400).json({ ok: false, message: "unknown directory" });
    if (!isToolGroup(group)) return res.status(400).json({ ok: false, message: `unknown tool group: ${group}` });
    const result = enabled ? registerGuiMcpGroup(claudeAdapter.bin(), cwd, group) : unregisterGuiMcpGroup(claudeAdapter.bin(), cwd, group);
    res.json(result);
  });
}
