// @vitest-environment node
// Remembering that a background worker ended badly.
//
// The record is the durable half of the signal: the notification tells you now, this is what lets
// you find out later. It has to survive a restart for the same reason it exists at all — nobody
// was watching when it happened.
//
// node:fs is MOCKED rather than pointing HOME at a temp dir, following tool-group-reset.spec: the
// env is shared by every file in a vitest worker, so moving HOME here reaches specs that have
// nothing to do with this one. It did — two unrelated files failed intermittently before this was
// written the other way.
import { describe, it, expect, vi, beforeEach } from "vitest";

const appended: { file: string; data: string }[] = [];

vi.mock("node:fs", () => {
  const promises = {
    readFile: vi.fn(async () => ""), // every registry hydrator reads through this; none has content
    appendFile: vi.fn(async (file: string, data: string) => {
      appended.push({ file: String(file), data });
    }),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
  };
  return { promises, default: { promises } };
});

const ID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

async function freshRegistry() {
  vi.resetModules();
  appended.length = 0;
  return import("../../../server/session/registry.js");
}

const failureLog = () =>
  appended
    .filter((a) => a.file.endsWith("failed-workers.json"))
    .map((a) => a.data)
    .join("");

beforeEach(() => vi.clearAllMocks());

describe("failed workers", () => {
  it("says no about a worker nobody reported", async () => {
    const registry = await freshRegistry();
    await registry.failedWorkersHydrated;
    expect(registry.isFailedWorker(ID)).toBe(false);
  });

  it("remembers one that was reported", async () => {
    const registry = await freshRegistry();
    registry.markFailedWorker(ID);
    expect(registry.isFailedWorker(ID)).toBe(true);
    expect(registry.isFailedWorker(OTHER)).toBe(false);
  });

  it("persists it, so the failure outlives the process that saw it", async () => {
    const registry = await freshRegistry();
    registry.markFailedWorker(OTHER);
    // The append is fire-and-forget; give its chain a turn to land.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failureLog()).toContain(OTHER);
  });

  it("ignores an id that is not a session id", async () => {
    // The mark is reached from a completion hook, so the id is server-generated — but this log is
    // read back and compared against real ids, and a junk line would sit there forever.
    const registry = await freshRegistry();
    registry.markFailedWorker("../etc/passwd");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failureLog()).not.toContain("passwd");
    expect(registry.isFailedWorker("../etc/passwd")).toBe(false);
  });

  it("does not append the same id twice", async () => {
    const registry = await freshRegistry();
    registry.markFailedWorker(ID);
    registry.markFailedWorker(ID);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failureLog().split(ID).length - 1).toBe(1);
  });

  it("hydrates what a previous run recorded", async () => {
    // The point of persisting: a restart must not forget a failure nobody has seen yet.
    vi.resetModules();
    const fs = await import("node:fs");
    vi.mocked(fs.promises.readFile).mockImplementation(async (file: unknown) => (String(file).endsWith("failed-workers.json") ? ID : ""));
    const registry = await import("../../../server/session/registry.js");
    await registry.failedWorkersHydrated;
    expect(registry.isFailedWorker(ID)).toBe(true);
  });
});
