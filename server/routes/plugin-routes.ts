// The three GUI-plugin tool routes this server answers itself, rather than through a plugin
// package's own router.
//
// All three MUST be mounted before mountAllRoutes' /api/plugin/:toolName catch-all, which
// would otherwise take them. Their failure reporting is narration by contract — see
// plugin-narration.ts for why a failed tool call must still be a 200.
import { randomUUID } from "node:crypto";
import type { Express } from "express";

import { CLAUDE_CWD, PORT } from "../config/env.js";
import { messageOf } from "../errors.js";
import { isRecord } from "../session/transcript.js";
import { hiddenSessions } from "../session/registry.js";
import { runWithHiddenMarker } from "../session/hiddenMarker.js";
import { backgroundChatMessage, parseBackgroundChat, spawnModeFor } from "../session/background-chat.js";
import { codexifySkillSeed } from "../agents/codex-skills.js";
import { manageCollectionHandler } from "../infra/collection-tool.js";
import { upstreamFailureMessage } from "./plugin-narration.js";
import type { SpawnClaudePty, SpawnCodexPty } from "../session/spawners.js";

export interface PluginRouteDeps {
  spawnClaudePty: SpawnClaudePty;
  spawnCodexPty: SpawnCodexPty;
}

export function mountPluginRoutes(app: Express, deps: PluginRouteDeps): void {
  // Host tool: spawnBackgroundChat. Unlike a plugin (handled by mountAllRoutes'
  // catch-all), it needs server internals — it spawns a brand-new interactive Claude
  // terminal session, seeded with `message`, that the user can open from the sidebar.
  // `role` is ignored (MulmoTerminal has no roles). `hidden:true` marks it a background
  // worker: it still lists in the sidebar but never renders bold/unread when it
  // finishes. `draft:true` makes `message` an editable DRAFT — typed into the input box
  // but NOT auto-submitted (the collection-plugin's startNewChatDraft / template cards),
  // so the user reviews and presses Enter.
  app.post("/api/plugin/spawnBackgroundChat", (req, res) => {
    const parsed = parseBackgroundChat(req.body);
    if (!parsed.ok) return res.json({ message: parsed.message });
    const { agent, draft, hidden, message } = parsed.request;
    const sessionId = randomUUID();
    // ws is null: the session runs headless until the user opens it (reattach replays the buffered
    // output). A claude draft spawns with NO initial prompt (so it doesn't auto-run) and gets the text
    // typed into its input box. codex has no editable-draft path (no stable TUI ready-marker), so its
    // seed always auto-runs as codex's positional first-turn prompt, with the GUI MCP attached.
    try {
      runWithHiddenMarker(hidden, sessionId, hiddenSessions, () => {
        const mode = spawnModeFor(agent, draft);
        if (mode === "codex-run") deps.spawnCodexPty(sessionId, null, null, CLAUDE_CWD, true, codexifySkillSeed(message));
        else if (mode === "claude-draft") deps.spawnClaudePty(sessionId, null, null, { draft: message });
        else deps.spawnClaudePty(sessionId, null, null, { initialPrompt: message });
      });
    } catch (err) {
      console.error(`[spawnBackgroundChat] failed for ${sessionId}: ${messageOf(err)}`);
      return res.json({ message: `Failed to spawn a new session: ${messageOf(err)}` });
    }
    return res.json({ message: backgroundChatMessage(agent, draft, sessionId), jsonData: { chatId: sessionId, agent } });
  });

  // Host tool: manageAccounting. The accounting package exposes no gui-chat-protocol
  // `.` core (just the Vue View + the /api/accounting router), so — like MulmoClaude's
  // host-side passthrough execute — this route bridges the GUI MCP tool to that router.
  // The router's envelope ({ action, ...data, message }) flows straight back to the
  // broker: `data` (set for PREVIEW actions) gates the GUI publish, `message` narrates
  // to claude.
  app.post("/api/plugin/manageAccounting", async (req, res) => {
    try {
      const upstream = await fetch(`http://127.0.0.1:${PORT}/api/accounting`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(isRecord(req.body) ? req.body : {}),
      });
      const body: unknown = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        // A refused request is only ever narrated to the agent, so without this it leaves no
        // trace on the server at all — and a router answering `{ error: "" }` leaves none with
        // the agent either. "Could not connect" is logged below; "connected and was refused"
        // should be too.
        const message = upstreamFailureMessage(upstream.status, body, "accounting request failed");
        console.error(`[manageAccounting] upstream ${upstream.status}: ${message || "(no message)"}`);
        return res.json({ message });
      }
      return res.json(body);
    } catch (err) {
      console.error(`[manageAccounting] dispatch failed: ${messageOf(err)}`);
      return res.json({ message: `accounting dispatch failed: ${messageOf(err)}` });
    }
  });

  // Host tool: manageCollection — the shared collection data plane
  // (@mulmoclaude/core/collection/server, bound in server/infra/collection-tool.ts).
  // The engine runs in-process against the configured workspace, so the route calls the
  // handler directly. The result string (JSON for the read/write actions) narrates to claude
  // via the envelope `message`; no `data`, so nothing publishes to the GUI — same as
  // MulmoClaude.
  app.post("/api/plugin/manageCollection", async (req, res) => {
    try {
      const message = await manageCollectionHandler(isRecord(req.body) ? req.body : {});
      return res.json({ message });
    } catch (err) {
      console.error(`[manageCollection] dispatch failed: ${messageOf(err)}`);
      return res.json({ message: `manageCollection failed: ${messageOf(err)}` });
    }
  });
}
