// @vitest-environment node
//
// Every spawner registers its pty through registerPty, which is what lets the board hear that a
// terminal opened anywhere (#3363).
import { describe, it, expect, afterEach, vi } from "vitest";
import type { PtyEntry } from "../../../../server/session/types.js";
import { fakePtyEntry } from "../../../helpers/fakePtyEntry.js";

// Only the pty table: the real registry hydrates its logs from the user's home on import.
vi.mock("../../../../server/session/registry.js", () => ({ ptys: new Map() }));

const { registerPty, onPtyRegistered } = await import("../../../../server/session/pty/pty-register.js");
const { ptys } = await import("../../../../server/session/registry.js");

const entry = (cwd: string): PtyEntry => fakePtyEntry({ cwd });

afterEach(() => {
  onPtyRegistered(null);
  ptys.clear();
});

describe("registerPty", () => {
  it("records the entry and tells the listener, after the entry is in the table", () => {
    const heard: { sessionId: string; cwd: string; inTable: boolean }[] = [];
    onPtyRegistered((sessionId, registered) => heard.push({ sessionId, cwd: registered.cwd, inTable: ptys.get(sessionId) === registered }));
    const first = entry("/w/a");
    registerPty("s1", first);
    registerPty("s2", entry("/w/b"));
    expect(ptys.get("s1")).toBe(first);
    expect(heard).toEqual([
      { sessionId: "s1", cwd: "/w/a", inTable: true },
      { sessionId: "s2", cwd: "/w/b", inTable: true },
    ]);
  });

  it("still records the entry with no listener set", () => {
    registerPty("s1", entry("/w/a"));
    expect(ptys.has("s1")).toBe(true);
  });

  it("stops telling a listener once it is cleared", () => {
    const heard: string[] = [];
    onPtyRegistered((sessionId) => heard.push(sessionId));
    onPtyRegistered(null);
    registerPty("s1", entry("/w/a"));
    expect(heard).toEqual([]);
  });
});
