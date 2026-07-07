import { describe, it, expect } from "vitest";
import { buildTerminalWsUrl, buildRunWsUrl, buildLaunchWsUrl, buildCodexWsUrl } from "./wsUrl";

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
