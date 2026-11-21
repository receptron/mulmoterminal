import { describe, it, expect, vi, afterEach } from "vitest";

const KEY = "githubBoardOpenWorkOnly";

async function freshSwitch() {
  vi.resetModules();
  return (await import("../../../src/composables/useBoardOpenWorkOnly")).useBoardOpenWorkOnly();
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("useBoardOpenWorkOnly", () => {
  it("is on when nothing is stored", async () => {
    expect((await freshSwitch()).boardOpenWorkOnly.value).toBe(true);
  });

  it.each([
    ["0", false],
    ["1", true],
    ["", true],
    ["garbage", true],
  ])("reads a stored %j as %s", async (stored, expected) => {
    localStorage.setItem(KEY, stored);
    expect((await freshSwitch()).boardOpenWorkOnly.value).toBe(expected);
  });

  it("remembers what was set, for the next page", async () => {
    (await freshSwitch()).setBoardOpenWorkOnly(false);
    expect(localStorage.getItem(KEY)).toBe("0");
    expect((await freshSwitch()).boardOpenWorkOnly.value).toBe(false);
  });

  it("falls back to on, and still switches, when storage throws", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { boardOpenWorkOnly, setBoardOpenWorkOnly } = await freshSwitch();
    expect(boardOpenWorkOnly.value).toBe(true);
    setBoardOpenWorkOnly(false);
    expect(boardOpenWorkOnly.value).toBe(false);
  });
});
