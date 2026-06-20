import { describe, it, expect } from "vitest";
import { buildTerminalWsUrl } from "./wsUrl";

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
    const url = buildTerminalWsUrl({ host: "h", secure: false, sessionId: null });
    expect(url).toBe("ws://h/ws");
  });

  it("uses wss when secure", () => {
    const url = buildTerminalWsUrl({ host: "h", secure: true, sessionId: "abc" });
    expect(url.startsWith("wss://")).toBe(true);
  });
});
