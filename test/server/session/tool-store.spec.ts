import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { capToolOutput, createSessionStore, createToolStores, toolCallsChannel } from "../../../server/session/tool-store.js";

const SESSION = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";

describe("capToolOutput", () => {
  it("passes a short string through untouched", () => {
    expect(capToolOutput("hello")).toBe("hello");
  });

  it("truncates a long string and says how much it dropped", () => {
    const out = capToolOutput("x".repeat(20_050));
    expect(typeof out).toBe("string");
    expect(String(out)).toContain("truncated 50 chars");
    expect(String(out).length).toBeLessThan(20_100);
  });

  it("keeps a string exactly at the cap whole", () => {
    expect(capToolOutput("x".repeat(20_000))).toBe("x".repeat(20_000));
  });

  // Only strings are capped — a structured output would be destroyed by slicing.
  it("leaves non-strings alone", () => {
    const obj = { a: 1 };
    expect(capToolOutput(obj)).toBe(obj);
    expect(capToolOutput(undefined)).toBeUndefined();
    expect(capToolOutput(null)).toBeNull();
    expect(capToolOutput(42)).toBe(42);
  });
});

describe("toolCallsChannel", () => {
  it("namespaces per session", () => {
    expect(toolCallsChannel("abc")).toBe("toolcalls:abc");
    expect(toolCallsChannel("abc")).not.toBe(toolCallsChannel("abd"));
  });
});

describe("createSessionStore", () => {
  let root = "";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "mt-store-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("starts empty and persists what it is given", async () => {
    const store = createSessionStore<{ n: number }>("things", root);
    const list = await store.get(SESSION);
    expect(list).toEqual([]);
    list.push({ n: 1 });
    await store.save(SESSION);
    expect(JSON.parse(await fs.readFile(path.join(root, "things", `${SESSION}.json`), "utf8"))).toEqual([{ n: 1 }]);
  });

  it("reloads a session's list from disk in a fresh store", async () => {
    await fs.mkdir(path.join(root, "things"), { recursive: true });
    await fs.writeFile(path.join(root, "things", `${SESSION}.json`), JSON.stringify([{ n: 7 }]));
    expect(await createSessionStore<{ n: number }>("things", root).get(SESSION)).toEqual([{ n: 7 }]);
  });

  it("hands back the SAME array each time, since callers mutate in place", async () => {
    const store = createSessionStore<{ n: number }>("things", root);
    const first = await store.get(SESSION);
    first.push({ n: 1 });
    expect(await store.get(SESSION)).toBe(first);
  });

  it("dedupes concurrent first loads into one list", async () => {
    const store = createSessionStore<{ n: number }>("things", root);
    const [a, b] = await Promise.all([store.get(SESSION), store.get(SESSION)]);
    expect(a).toBe(b);
  });

  it("keeps sessions apart", async () => {
    const store = createSessionStore<{ n: number }>("things", root);
    (await store.get(SESSION)).push({ n: 1 });
    expect(await store.get(OTHER)).toEqual([]);
  });

  it("starts empty when the file is corrupt or not an array", async () => {
    await fs.mkdir(path.join(root, "things"), { recursive: true });
    await fs.writeFile(path.join(root, "things", `${SESSION}.json`), "{not json");
    expect(await createSessionStore("things", root).get(SESSION)).toEqual([]);
    await fs.writeFile(path.join(root, "things", `${OTHER}.json`), '{"a":1}');
    expect(await createSessionStore("things", root).get(OTHER)).toEqual([]);
  });

  // The id becomes a filename, so a bad one must never reach the disk.
  it("refuses to read or write an id that is not a session uuid", async () => {
    const store = createSessionStore<{ n: number }>("things", root);
    const list = await store.get("../escape");
    expect(list).toEqual([]);
    list.push({ n: 1 });
    await store.save("../escape");
    await expect(fs.stat(path.join(root, "escape.json"))).rejects.toThrow();
    await expect(fs.stat(path.join(root, "things"))).rejects.toThrow();
  });
});

describe("createToolStores", () => {
  let root = "";
  const publish = vi.fn();

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "mt-tools-"));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const stores = () => createToolStores({ publish, root });

  it("appends a tool result", async () => {
    const s = stores();
    await s.storeToolResult(SESSION, { uuid: "a", value: 1 });
    expect(await s.toolResultsStore.get(SESSION)).toEqual([{ uuid: "a", value: 1 }]);
  });

  // A form that re-emits after its state changes must update, not stack up.
  it("replaces a result with the same uuid in place", async () => {
    const s = stores();
    await s.storeToolResult(SESSION, { uuid: "a", value: 1 });
    await s.storeToolResult(SESSION, { uuid: "a", value: 2 });
    expect(await s.toolResultsStore.get(SESSION)).toEqual([{ uuid: "a", value: 2 }]);
  });

  it("caps the result history at 50, keeping the newest", async () => {
    const s = stores();
    for (let i = 0; i < 55; i++) await s.storeToolResult(SESSION, { uuid: `u${i}` });
    const list = await s.toolResultsStore.get(SESSION);
    expect(list).toHaveLength(50);
    expect(list[0].uuid).toBe("u5");
    expect(list.at(-1)?.uuid).toBe("u54");
  });

  it("records a call as running, then completes the SAME entry", async () => {
    const s = stores();
    await s.recordToolCallStart(SESSION, { toolUseId: "t1", toolName: "Bash", toolInput: { command: "ls" } });
    await s.recordToolCallEnd(SESSION, { toolUseId: "t1", toolOutput: "done", durationMs: 12, status: "ok" });
    const list = await s.toolCallsStore.get(SESSION);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ toolUseId: "t1", toolName: "Bash", status: "ok", toolOutput: "done", durationMs: 12 });
  });

  // PostToolUseFailure can arrive without a matching start (e.g. after a restart).
  it("creates an entry when an end arrives with no start", async () => {
    const s = stores();
    await s.recordToolCallEnd(SESSION, { toolUseId: "orphan", toolName: "Read", status: "error" });
    expect(await s.toolCallsStore.get(SESSION)).toHaveLength(1);
  });

  it("caps a long tool output when storing it", async () => {
    const s = stores();
    await s.recordToolCallEnd(SESSION, { toolUseId: "t1", toolOutput: "x".repeat(20_050), status: "ok" });
    expect(String((await s.toolCallsStore.get(SESSION))[0].toolOutput)).toContain("truncated");
  });

  it("publishes each call on the session's channel so the pane can follow it", async () => {
    const s = stores();
    await s.recordToolCallStart(SESSION, { toolUseId: "t1", toolName: "Bash" });
    await s.recordToolCallEnd(SESSION, { toolUseId: "t1", status: "ok" });
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls.every(([channel]) => channel === `toolcalls:${SESSION}`)).toBe(true);
  });

  it("writes under the injected root, never the real home", async () => {
    const s = stores();
    await s.storeToolResult(SESSION, { uuid: "a" });
    await s.recordToolCallStart(SESSION, { toolUseId: "t1" });
    expect((await fs.readdir(root)).sort()).toEqual(["toolcalls", "toolresults"]);
  });
});
