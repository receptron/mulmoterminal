// Host tools: built-in GUI-protocol tools whose execute lives in the main server
// (server/index.ts) rather than in a plugin module, because they need server
// internals the plugin sandbox doesn't expose — e.g. the live PTY table. The
// registry owns only their DEFINITIONS, so the MCP broker lists them and they're
// auto-allowed (allowedToolNames); index.ts mounts their dispatch route itself,
// before plugins-registry's catch-all /api/plugin/:toolName.
import type { ToolDefinition } from "gui-chat-protocol";

// Mirrors MulmoClaude's spawnBackgroundChat signature (message/role/hidden) so the
// tool is a drop-in from the model's point of view — but the implementation is
// completely different: instead of starting an SDK chat, it spawns a brand-new
// interactive Claude terminal session on the server, seeded with `message`, that
// the user can open from the sidebar. `role` and `hidden` are accepted for
// signature parity but ignored: the spawned session is always a visible terminal.
export const SPAWN_BACKGROUND_CHAT: ToolDefinition = {
  type: "function",
  name: "spawnBackgroundChat",
  description:
    "Launch a separate, parallel chat session that runs its own agent turn concurrently with this conversation, then returns immediately (fire-and-forget). Use it to do work off the critical path — e.g. pre-generate an artifact the user will need soon — without blocking the current turn. Returns the new session's chatId.",
  prompt:
    "Use `spawnBackgroundChat` to run work in parallel with the current conversation instead of making the user wait for it inline. " +
    "The `message` must be fully self-contained — the spawned session shares NONE of this chat's context — and should state exactly what to produce and where to write it. " +
    "It returns right away with a `chatId`; it does NOT wait for the spawned session to finish. The new session appears in the sidebar and the user can open it at any time.",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description:
          "The first user turn for the spawned session — a complete, self-contained instruction, since the worker shares none of this conversation's context.",
      },
      role: {
        type: "string",
        description: "Role id the spawned session runs in. (Accepted for compatibility; currently ignored.)",
      },
      hidden: {
        type: "boolean",
        description: "Accepted for compatibility; currently ignored — the spawned session is always visible to the user.",
      },
    },
    required: ["message", "role", "hidden"],
  },
};

export const HOST_TOOL_DEFINITIONS: ToolDefinition[] = [SPAWN_BACKGROUND_CHAT];
