import { describe, it, expect } from "vitest";
import { buildTerminalWsUrl, buildRunWsUrl, buildLaunchWsUrl, buildCodexWsUrl, connWsUrl, type ConnTargetUrlInput } from "../../../src/components/wsUrl.js";

describe("buildTerminalWsUrl", () => {
  it("single view: session only, no gui=0", () => {
    const url = buildTerminalWsUrl({ host: "localhost:3456", secure: false, sessionId: "abc" });
    expect(url).toBe("ws://localhost:3456/ws?session=abc");
    expect(url).not.toContain("gui=0");
  });

  it("grid dev terminal: adds gui=0 so the server skips the GUI MCP", () => {
    const url = buildTerminalWsUrl({ host: "h", secure: false, sessionId: "abc", devTerminal: true });
    expect(new URL(url).searchParams.get("gui")).toBe("0");
  });

  it("includes the chosen cwd", () => {
    const url = buildTerminalWsUrl({ host: "h", secure: false, sessionId: "abc", cwd: "/work/proj", devTerminal: true });
    const q = new URL(url).searchParams;
    expect(q.get("cwd")).toBe("/work/proj");
    expect(q.get("gui")).toBe("0");
  });

  it("fresh session (null id): no session param", () => {
    const url = buildTerminalWsUrl({ host: "localhost", secure: false, sessionId: null });
    expect(url).toBe("ws://localhost/ws");
  });

  it("uses wss when secure", () => {
    const url = buildTerminalWsUrl({ host: "h", secure: true, sessionId: "abc" });
    expect(url.startsWith("wss://")).toBe(true);
  });
});

describe("buildRunWsUrl", () => {
  it("targets /ws/run with the script index", () => {
    const url = buildRunWsUrl({ host: "localhost:3456", secure: false, index: 2 });
    expect(url).toBe("ws://localhost:3456/ws/run?index=2");
  });

  it("includes the directory the index refers to", () => {
    const url = buildRunWsUrl({ host: "h", secure: false, index: 1, cwd: "/work/proj" });
    const q = new URL(url).searchParams;
    expect(q.get("index")).toBe("1");
    expect(q.get("cwd")).toBe("/work/proj");
  });

  it("uses wss when secure", () => {
    const url = buildRunWsUrl({ host: "h", secure: true, index: 0 });
    expect(url.startsWith("wss://")).toBe(true);
    expect(new URL(url).searchParams.get("index")).toBe("0");
  });

  it("targets /ws/run with a header button id + session context (no index)", () => {
    const url = buildRunWsUrl({ host: "h", secure: false, cwd: "/work/proj", buttonId: "pr", session: "s1", agent: "codex", model: "claude-opus-4-8" });
    const q = new URL(url).searchParams;
    expect(q.get("buttonId")).toBe("pr");
    expect(q.get("cwd")).toBe("/work/proj");
    expect(q.get("session")).toBe("s1");
    expect(q.get("agent")).toBe("codex");
    expect(q.get("model")).toBe("claude-opus-4-8");
    expect(q.get("index")).toBeNull();
  });

  it("omits an absent session/model for a button command", () => {
    const q = new URL(buildRunWsUrl({ host: "h", secure: false, buttonId: "b", session: null, agent: "claude", model: null })).searchParams;
    expect(q.get("buttonId")).toBe("b");
    expect(q.get("agent")).toBe("claude");
    expect(q.has("session")).toBe(false);
    expect(q.has("model")).toBe(false);
  });
});

describe("buildLaunchWsUrl", () => {
  it("targets /ws/launch with the launcher index + reattach session", () => {
    const url = buildLaunchWsUrl({ host: "h", secure: false, sessionId: "abc", cwd: "/work/proj", launcher: 2 });
    const u = new URL(url);
    expect(u.pathname).toBe("/ws/launch");
    expect(u.searchParams.get("launcher")).toBe("2");
    expect(u.searchParams.get("session")).toBe("abc");
    expect(u.searchParams.get("cwd")).toBe("/work/proj");
  });

  it("fresh launch (null id): no session param, still sends the launcher index", () => {
    const url = buildLaunchWsUrl({ host: "h", secure: false, sessionId: null, launcher: 0 });
    const q = new URL(url).searchParams;
    expect(q.has("session")).toBe(false);
    expect(q.get("launcher")).toBe("0");
  });

  it("uses wss when secure", () => {
    const url = buildLaunchWsUrl({ host: "h", secure: true, sessionId: null, launcher: 1 });
    expect(url.startsWith("wss://")).toBe(true);
  });

  it("shell: sends shell=1 and no launcher index (the OS default shell)", () => {
    const q = new URL(buildLaunchWsUrl({ host: "h", secure: false, sessionId: null, cwd: "/proj", shell: true })).searchParams;
    expect(q.get("shell")).toBe("1");
    expect(q.has("launcher")).toBe(false);
    expect(q.get("cwd")).toBe("/proj");
  });
});

describe("buildCodexWsUrl", () => {
  it("targets /ws/codex with the reattach session + cwd", () => {
    const u = new URL(buildCodexWsUrl({ host: "h", secure: false, sessionId: "abc", cwd: "/work/proj" }));
    expect(u.pathname).toBe("/ws/codex");
    expect(u.searchParams.get("session")).toBe("abc");
    expect(u.searchParams.get("cwd")).toBe("/work/proj");
  });

  it("fresh codex (null id): no session param", () => {
    const u = new URL(buildCodexWsUrl({ host: "h", secure: false, sessionId: null }));
    expect(u.pathname).toBe("/ws/codex");
    expect(u.searchParams.has("session")).toBe(false);
  });

  it("uses wss when secure", () => {
    expect(buildCodexWsUrl({ host: "h", secure: true, sessionId: null }).startsWith("wss://")).toBe(true);
  });

  it("adds gui=0 for a grid dev terminal (no GUI MCP)", () => {
    const u = new URL(buildCodexWsUrl({ host: "h", secure: false, sessionId: null, devTerminal: true }));
    expect(u.searchParams.get("gui")).toBe("0");
  });

  it("omits gui for the single view (GUI MCP on)", () => {
    const u = new URL(buildCodexWsUrl({ host: "h", secure: false, sessionId: null }));
    expect(u.searchParams.has("gui")).toBe(false);
  });
});

describe("buildTerminalWsUrl — the launch picker's choice (#584)", () => {
  const base = { host: "h", secure: false, sessionId: null };

  // Absent params are what tell the server to use the directory's own .mulmoterminal.json,
  // so the default launch must send neither.
  it("sends neither param when nothing was picked", () => {
    const q = new URL(buildTerminalWsUrl({ ...base, launch: null })).searchParams;
    expect(q.has("provider")).toBe(false);
    expect(q.has("model")).toBe(false);
  });

  it("sends the picked provider and model", () => {
    const q = new URL(buildTerminalWsUrl({ ...base, launch: { provider: "openrouter", model: "moonshotai/kimi-k2.7-code" } })).searchParams;
    expect(q.get("provider")).toBe("openrouter");
    expect(q.get("model")).toBe("moonshotai/kimi-k2.7-code");
  });

  // Picking an Anthropic model ("run this one on Opus") names no provider.
  it("sends a bare model with no provider", () => {
    const q = new URL(buildTerminalWsUrl({ ...base, launch: { provider: null, model: "claude-opus-4-8" } })).searchParams;
    expect(q.get("model")).toBe("claude-opus-4-8");
    expect(q.has("provider")).toBe(false);
  });

  it("escapes a model id containing a slash", () => {
    expect(buildTerminalWsUrl({ ...base, launch: { model: "z-ai/glm-5.2" } })).toContain("model=z-ai%2Fglm-5.2");
  });

  it("keeps carrying session, cwd and gui alongside it", () => {
    const q = new URL(buildTerminalWsUrl({ host: "h", secure: false, sessionId: "abc", cwd: "/w", devTerminal: true, launch: { model: "m" } })).searchParams;
    expect([q.get("session"), q.get("cwd"), q.get("gui"), q.get("model")]).toEqual(["abc", "/w", "0", "m"]);
  });
});

// Which endpoint a slot connects to. The precedence is the rule, and every way of getting it
// wrong is silent: the cell reconnects, looks alive, and is the wrong thing.
describe("connWsUrl — endpoint precedence", () => {
  const HOST = "localhost:3456";
  const target = (over: Partial<ConnTargetUrlInput> = {}): ConnTargetUrlInput => ({
    cwd: "/work/proj",
    devTerminal: false,
    command: null,
    launcher: null,
    ...over,
  });
  const pathOf = (url: string) => new URL(url).pathname;

  it("defaults to the Claude session endpoint", () => {
    expect(pathOf(connWsUrl(target(), "abc", HOST, false))).toBe("/ws");
  });

  it("sends a codex slot to the codex endpoint, not the Claude one", () => {
    expect(pathOf(connWsUrl(target({ codex: true }), "abc", HOST, false))).toBe("/ws/codex");
  });

  it("sends a launcher slot to the launch endpoint", () => {
    expect(pathOf(connWsUrl(target({ launcher: { index: 2 } }), "abc", HOST, false))).toBe("/ws/launch");
  });

  it("sends a command slot to the run endpoint", () => {
    const url = connWsUrl(target({ command: { source: "script", index: 3, label: "build", cwd: "/work/proj" } }), null, HOST, false);
    expect(pathOf(url)).toBe("/ws/run");
    expect(new URL(url).searchParams.get("index")).toBe("3");
  });

  // The order matters, not just the mapping: a command slot that also carries a launcher or
  // codex flag is still a one-off Run, and reconnecting it as a session would re-run it.
  it("lets a command outrank a launcher and codex", () => {
    const command = { source: "script", index: 0, label: "x", cwd: null } as const;
    expect(pathOf(connWsUrl(target({ command, launcher: { shell: true }, codex: true }), "abc", HOST, false))).toBe("/ws/run");
  });

  it("lets a launcher outrank codex", () => {
    expect(pathOf(connWsUrl(target({ launcher: { shell: true }, codex: true }), "abc", HOST, false))).toBe("/ws/launch");
  });

  it("distinguishes the OS shell launcher from a configured one", () => {
    const shell = new URL(connWsUrl(target({ launcher: { shell: true } }), "abc", HOST, false)).searchParams;
    const indexed = new URL(connWsUrl(target({ launcher: { index: 4 } }), "abc", HOST, false)).searchParams;
    expect([shell.get("shell"), shell.get("launcher")]).toEqual(["1", null]);
    expect([indexed.get("shell"), indexed.get("launcher")]).toEqual([null, "4"]);
  });

  it("re-resolves a header button server-side, sending its context rather than a command", () => {
    const command = { source: "button", buttonId: "diff", label: "Diff", cwd: "/w", session: "s1", agent: "codex", model: "opus" } as const;
    const q = new URL(connWsUrl(target({ command }), null, HOST, false)).searchParams;
    expect([q.get("buttonId"), q.get("session"), q.get("agent"), q.get("model")]).toEqual(["diff", "s1", "codex", "opus"]);
  });

  it("carries the resume id, cwd, dev-terminal flag and launch pick to the session endpoint", () => {
    const url = connWsUrl(target({ devTerminal: true, launch: { provider: "openrouter", model: "z-ai/glm-5.2" } }), "sess-1", HOST, false);
    const q = new URL(url).searchParams;
    expect([q.get("session"), q.get("cwd"), q.get("gui"), q.get("provider")]).toEqual(["sess-1", "/work/proj", "0", "openrouter"]);
  });

  it("uses wss over https", () => {
    expect(connWsUrl(target(), null, HOST, true).startsWith("wss://")).toBe(true);
  });
});
