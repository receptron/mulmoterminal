import { describe, it, expect } from "vitest";
import { CELL_ACTIONS } from "../../../common/headerActions";
import { cellActionAllowed, isRemoteHost, onThisMachine, terminalPathFor } from "../../../src/components/remoteCell";
import { connWsUrl, type ConnTargetUrlInput } from "../../../src/components/wsUrl";

describe("isRemoteHost / onThisMachine", () => {
  it("treats only a non-empty string as a remote host", () => {
    expect(isRemoteHost("lx")).toBe(true);
    [null, undefined, ""].forEach((host) => expect(isRemoteHost(host)).toBe(false));
  });
  it("keeps the value for a local cell and drops it for a remote one", () => {
    expect(onThisMachine(null, "/p")).toBe("/p");
    expect(onThisMachine(undefined, "/p")).toBe("/p");
    expect(onThisMachine("lx", "/p")).toBeNull();
    expect(onThisMachine(null, null)).toBeNull();
  });
});

describe("cellActionAllowed", () => {
  // The whole list, so a change to what a remote cell may do is a visible edit here.
  const ALLOWED_ON_REMOTE = ["zoom-toggle", "mark-unread", "terminal-close", "terminal-move-prev", "terminal-move-next", "terminal-park", "terminal-voice"];

  it("allows every action on a local cell", () => {
    CELL_ACTIONS.forEach((action) => expect(cellActionAllowed(null, action)).toBe(true));
  });
  it("allows on a remote cell only what never asks this server about the cell", () => {
    expect(CELL_ACTIONS.filter((action) => cellActionAllowed("lx", action))).toEqual(ALLOWED_ON_REMOTE);
  });
});

describe("terminal paths", () => {
  it("routes a remote cell through the gateway and leaves a local one alone", () => {
    expect(terminalPathFor("lx", "/ws/launch")).toBe("/remote/lx/ws/launch");
    expect(terminalPathFor(null, "/ws/launch")).toBe("/ws/launch");
  });

  const base: ConnTargetUrlInput = { cwd: "/srv/p", devTerminal: false, command: null, launcher: null };
  const targets: ConnTargetUrlInput[] = [
    base,
    { ...base, agent: "codex" },
    { ...base, agent: "cursor", account: "work" },
    { ...base, launcher: { shell: true } },
    { ...base, launcher: { index: 2 } },
    { ...base, cwd: null, devTerminal: true },
    { ...base, customAgent: "nemo", launch: { provider: "ollama", model: "x y" } },
  ];
  const resumes = [null, "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69"];
  const sizes = [null, { cols: 120, rows: 40 }];

  const cases = targets.flatMap((target) => resumes.flatMap((resume) => sizes.map((size) => ({ target, resume, size }))));

  it("leaves a local cell's URL exactly as it was, for every endpoint", () => {
    cases.forEach(({ target, resume, size }) => {
      const before = connWsUrl(target, resume, "localhost:34567", false, size);
      expect(connWsUrl({ ...target, remoteHost: null }, resume, "localhost:34567", false, size)).toBe(before);
    });
  });

  it("prefixes only the path of a remote cell's URL, keeping host and query", () => {
    cases.forEach(({ target, resume, size }) => {
      const local = new URL(connWsUrl(target, resume, "localhost:34567", true, size));
      const remote = new URL(connWsUrl({ ...target, remoteHost: "lx" }, resume, "localhost:34567", true, size));
      expect(remote.host).toBe(local.host);
      expect(remote.protocol).toBe("wss:");
      expect(remote.pathname).toBe(`/remote/lx${local.pathname}`);
      expect(remote.search).toBe(local.search);
    });
  });
});
