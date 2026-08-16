// What index.ts still owns after the PTY machinery moved out (#548 step 3c). The json
// builders read config it holds; `reap` and `setWorking` drive a session lifecycle that
// reaches well beyond spawning, so they arrive as deps rather than as imports.
export interface SpawnDeps {
  claudeBin: string;
  codexBin: string;
  codexModel: string | null;
  antigravityBin: string;
  antigravityModel: string | null;
  grokBin: string;
  grokModel: string | null;
  museBin: string;
  museModel: string | null;
  permissionMode: string;
  /** Tool names auto-allowed for every session, already comma-joined. */
  guiMcpTools: string;
  // The --allowedTools list for a GRID cell, whose GUI tools come from the user's own
  // per-folder MCP config rather than from --mcp-config. See GRID_MCP_TOOLS in index.ts.
  gridMcpTools: string;
  /** Bytes of pty output kept for a client that reattaches later. */
  outputBufferLimit: number;
  hookSettingsJson: (host: string, sessionId: string, env?: Record<string, string>) => string;
  mcpConfigJson: (sessionId: string, host?: string) => string;
  reap: (id: string) => void;
  setWorking: (id: string, working: boolean, event?: string) => void;
  /** Needed alongside setWorking because a finished codex turn flags the cell for attention,
   *  exactly as claude's Stop hook does — see codex-activity-watch. */
  setWaiting: (id: string, waiting: boolean, event?: string) => void;
  /** Which port this host's UI answers on, so a codex completion notification can open it. */
  uiPort: string;
  /** Surface a brand-new session in the sidebar before it is persisted. */
  publishSessionCreated: (sessionId: string) => void;
  /** Re-publish a session's row when something a cell reads has changed but its activity has not —
   *  an agent that mints its conversation id asynchronously answers its model badge only once that
   *  id is known (spawn-antigravity.ts). */
  publishActivity: (sessionId: string) => void;
  /** Tell an open prompts pane that this session's list just grew. Distinct from publishActivity
   *  because that one is suppressed when the flag does not move, and the prompt that interrupts a
   *  running turn moves nothing (common/promptChannel.ts). */
  publishPromptSubmitted: (sessionId: string) => void;
}
