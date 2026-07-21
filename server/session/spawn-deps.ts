// What index.ts still owns after the PTY machinery moved out (#548 step 3c). The json
// builders read config it holds; `reap` and `setWorking` drive a session lifecycle that
// reaches well beyond spawning, so they arrive as deps rather than as imports.
export interface SpawnDeps {
  claudeBin: string;
  codexBin: string;
  codexModel: string | null;
  permissionMode: string;
  /** Tool names auto-allowed for every session, already comma-joined. */
  guiMcpTools: string;
  /** Bytes of pty output kept for a client that reattaches later. */
  outputBufferLimit: number;
  hookSettingsJson: (host: string, sessionId: string) => string;
  mcpConfigJson: (sessionId: string, host?: string, sandbox?: boolean) => string;
  reap: (id: string) => void;
  setWorking: (id: string, working: boolean) => void;
  /** Surface a brand-new session in the sidebar before it is persisted. */
  publishSessionCreated: (sessionId: string) => void;
}
