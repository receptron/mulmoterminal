import { describe, it, expect } from "vitest";
import { parseGridState, setCellAgent, type Cell, type GridState } from "../../../src/components/gridTabs";
import { closedCellOf } from "../../../src/composables/recentlyClosed";

const SESSION = "0b8f0a0e-7c55-4c1e-9e0a-3f1d2c4b5a69";
const stateWith = (cell: Partial<Cell>): GridState => ({
  cells: [{ uid: 0, session: SESSION, cwd: "/srv/p", ...cell }],
  expanded: null,
  page: 0,
  nextUid: 1,
  sortMode: "manual",
});

describe("a remote cell in grid_v2", () => {
  it("keeps its host across a reload", () => {
    expect(parseGridState(JSON.stringify(stateWith({ remoteHost: "lx" })))?.cells[0]?.remoteHost).toBe("lx");
  });
  it("drops a host that is not a valid id, leaving the key absent", () => {
    ["", "LX", "a/b", 3, null, {}].forEach((remoteHost) => {
      const cell = parseGridState(JSON.stringify({ ...stateWith({}), cells: [{ uid: 0, session: SESSION, cwd: "/srv/p", remoteHost }] }))?.cells[0];
      expect(cell && "remoteHost" in cell).toBe(false);
    });
  });
  it("keeps its host when the agent is recorded", () => {
    expect(setCellAgent(stateWith({ remoteHost: "lx" }), 0, "codex").cells[0]?.remoteHost).toBe("lx");
  });
});

describe("closing a remote cell", () => {
  it("is not offered for reopening, where it would come back as a local session", () => {
    expect(closedCellOf({ uid: 0, session: SESSION, cwd: "/srv/p", remoteHost: "lx" }, "t", 1)).toBeNull();
    expect(closedCellOf({ uid: 0, session: SESSION, cwd: "/srv/p" }, "t", 1)).not.toBeNull();
  });
});
