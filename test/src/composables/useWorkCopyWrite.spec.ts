// Writing a memory's text over the same memory in another work copy (#3331): over the version that
// copy had when read, and an Undo that puts its own text back only while nothing changed it since.
import { describe, it, expect, vi, beforeEach } from "vitest";

let there: { text: string | null; version?: string } | null = { text: "theirs", version: "v-there" };
/** When set, a read waits for it: a write is then still in flight. */
let held: Promise<void> | null = null;
let saveAnswers: { kind: string; version?: string }[] = [];
const saves: [string, string, string, string][] = [];
let running = false;
vi.mock("../../../src/composables/libraryApi", () => ({
  loadLibraryMemoryFile: async () => {
    await held;
    return there;
  },
  saveLibraryMemoryFile: (slug: string, file: string, text: string, version: string) => {
    saves.push([slug, file, text, version]);
    return Promise.resolve(saveAnswers.shift() ?? { kind: "saved", version: "v-new" });
  },
}));
vi.mock("../../../src/components/library/memorySessions", () => ({ sessionRunningIn: () => Promise.resolve(running) }));

const { useWorkCopyWrite } = await import("../../../src/composables/useWorkCopyWrite");
const TARGET = { slug: "-w-app3", file: "a.md", name: "app3", cwd: "/w/app3" };

beforeEach(() => {
  held = null;
  there = { text: "theirs", version: "v-there" };
  saveAnswers = [];
  saves.length = 0;
  running = false;
});

describe("useWorkCopyWrite", () => {
  it("writes over the version the copy had when read, says so, and Undo puts its own text back over what was written", async () => {
    const changed = vi.fn();
    const { notice, writeThere, undo } = useWorkCopyWrite(changed);
    await writeThere(TARGET, "mine");
    expect(saves).toEqual([["-w-app3", "a.md", "mine", "v-there"]]);
    expect(notice.value).toEqual({ kind: "written", name: "app3", running: false });
    expect(changed).toHaveBeenCalledTimes(1);
    await undo();
    expect(saves[1]).toEqual(["-w-app3", "a.md", "theirs", "v-new"]);
    expect(notice.value).toEqual({ kind: "undone", name: "app3" });
    expect(changed).toHaveBeenCalledTimes(2);
    await undo(); // done once
    expect(saves).toHaveLength(2);
  });

  it("adds that a session is running in the copy", async () => {
    running = true;
    const { notice, writeThere } = useWorkCopyWrite(() => undefined);
    await writeThere(TARGET, "mine");
    expect(notice.value).toEqual({ kind: "written", name: "app3", running: true });
  });

  it("writes nothing when the copy already holds the text, cannot be read, or changed before the write", async () => {
    const { notice, writeThere } = useWorkCopyWrite(() => undefined);
    there = { text: "mine", version: "v" };
    await writeThere(TARGET, "mine");
    expect(notice.value).toEqual({ kind: "same", name: "app3" });
    there = null;
    await writeThere(TARGET, "mine");
    expect(notice.value).toEqual({ kind: "failed", name: "app3" });
    there = { text: "theirs", version: "v-there" };
    saveAnswers = [{ kind: "changed" }];
    await writeThere(TARGET, "mine");
    expect(notice.value).toEqual({ kind: "changed", name: "app3" });
    expect(saves).toHaveLength(1);
  });

  it("leaves a copy changed since the write as it is on Undo, and keeps Undo after one that failed", async () => {
    const { notice, writeThere, undo } = useWorkCopyWrite(() => undefined);
    await writeThere(TARGET, "mine");
    saveAnswers = [{ kind: "failed" }];
    await undo();
    expect(notice.value).toEqual({ kind: "written", name: "app3", running: false, undoFailed: true });
    saveAnswers = [{ kind: "changed" }];
    await undo();
    expect(notice.value).toEqual({ kind: "undo-changed", name: "app3" });
    await undo();
    expect(saves).toHaveLength(3);
  });

  it("takes one write at a time, so the Undo kept is never another write's", async () => {
    let release = (): void => undefined;
    held = new Promise((resolve) => (release = resolve));
    const { busy, writeThere } = useWorkCopyWrite(() => undefined);
    const first = writeThere(TARGET, "mine");
    expect(busy.value).toBe(true);
    await writeThere({ ...TARGET, slug: "-w-app4", name: "app4" }, "mine");
    release();
    await first;
    expect(saves.map(([slug]) => slug)).toEqual(["-w-app3"]);
    expect(busy.value).toBe(false);
  });
});
