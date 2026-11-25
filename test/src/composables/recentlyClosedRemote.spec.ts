// A cell closed on a remote host (#3506) comes back on that host. Reopened without it, the session id
// would be looked up on THIS machine, which has never seen it.
import { describe, it, expect } from "vitest";
import { cellForClosed, closedCellId, closedCellOf, readClosedCells, rememberClosed, reopenableClosed } from "../../../src/composables/recentlyClosed";
import type { Cell } from "../../../src/components/gridTabs";

const SESSION = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
const agentCell: Cell = { uid: 0, session: SESSION, cwd: "/srv/p", agent: "codex", remoteHost: "lx" };
const shellCellOn = (remoteHost?: string): Cell => ({
  uid: 1,
  session: null,
  cwd: "/srv/p",
  launcher: { shell: true, label: "shell" },
  ...(remoteHost ? { remoteHost } : {}),
});

describe("a remote cell in recently closed", () => {
  it("is recorded with its host, for an agent session and for a shell", () => {
    expect(closedCellOf(agentCell, "t", 1)).toEqual({
      kind: "session",
      session: SESSION,
      cwd: "/srv/p",
      agent: "codex",
      account: null,
      title: "t",
      closedAt: 1,
      remoteHost: "lx",
    });
    expect(closedCellOf(shellCellOn("lx"), null, 1)).toEqual({ kind: "shell", cwd: "/srv/p", title: "p", closedAt: 1, remoteHost: "lx" });
  });

  it("reopens on the same host, as the cell it was", () => {
    const sessionEntry = closedCellOf(agentCell, "t", 1);
    const shellEntry = closedCellOf(shellCellOn("lx"), null, 1);
    expect(sessionEntry && cellForClosed(sessionEntry)).toEqual({ session: SESSION, cwd: "/srv/p", agent: "codex", remoteHost: "lx" });
    expect(shellEntry && cellForClosed(shellEntry)).toMatchObject({ session: null, cwd: "/srv/p", launcher: { shell: true }, remoteHost: "lx" });
  });

  it("is a different entry from the same directory's shell on this machine", () => {
    const remote = closedCellOf(shellCellOn("lx"), null, 1);
    const local = closedCellOf(shellCellOn(), null, 2);
    expect(remote && local && closedCellId(remote)).not.toBe(local && closedCellId(local));
    expect(remote && local && rememberClosed([remote], local)).toHaveLength(2);
    // A local entry is stored exactly as before the host existed: no key at all, not one holding undefined.
    expect(local && Object.keys(local)).not.toContain("remoteHost");
  });

  it("survives a reload, and an entry naming an invalid host is dropped rather than reopened here", () => {
    const entry = closedCellOf(agentCell, "t", 1);
    expect(readClosedCells(JSON.parse(JSON.stringify([entry])))).toEqual([entry]);
    ["", "LX", "a/b", 3, null].forEach((remoteHost) => expect(readClosedCells([{ ...entry, remoteHost }])).toEqual([]));
  });

  it("is not offered while its session is open again", () => {
    const entry = closedCellOf(agentCell, "t", 1);
    expect(entry && reopenableClosed([entry], [SESSION])).toEqual([]);
  });
});

describe("a closed cell on a host removed from the config", () => {
  const remote = closedCellOf(agentCell, "t", 1);
  const local = closedCellOf(shellCellOn(), null, 2);
  const entries = [remote, local].filter((entry) => entry !== null);

  it("is not offered, while this machine's entries are", () => {
    expect(reopenableClosed(entries, [], (host) => host === "lx")).toEqual([local]);
    expect(reopenableClosed(entries, [], () => false)).toEqual(entries);
  });
  it("asks about the host only for an entry that has one", () => {
    const asked: string[] = [];
    reopenableClosed(entries, [], (host) => {
      asked.push(host);
      return false;
    });
    expect(asked).toEqual(["lx"]);
  });
});
