// The grid's layout copied to the server, and offered back to a grid that loaded without one (#3427).
// The module keeps its state at module level, so each test loads a fresh copy after its mocks.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const DEBOUNCE_MS = 1000;

const opened = vi.hoisted(() => ({ cells: [] as unknown[] }));
vi.mock("../../../src/composables/useNewTerminal", () => ({ openCellAt: (cell: unknown) => opened.cells.push(cell) }));

interface Call {
  method: string;
  body: unknown;
}
let calls: Call[] = [];
let serverCopy: unknown = null;
let attached: string[] = [];
let postStatus = 200;

const stored = (cells: Array<{ session: string | null; cwd: string | null }>) =>
  JSON.stringify({ cells: cells.map((cell, uid) => ({ uid, ...cell })), expanded: null, page: 0, nextUid: cells.length, sortMode: "manual" });

// Each fresh copy of the module adds its own pagehide listener; the previous copy's is taken off, or
// a page leaving in one test would be answered by every copy loaded before it.
const leaveListeners: EventListenerOrEventListenerObject[] = [];
const load = async () => {
  leaveListeners.splice(0).forEach((listener) => window.removeEventListener("pagehide", listener));
  const add = vi.spyOn(window, "addEventListener");
  vi.resetModules();
  const mirror = await import("../../../src/composables/gridLayoutMirror");
  add.mock.calls.filter(([type]) => type === "pagehide").forEach(([, listener]) => leaveListeners.push(listener));
  add.mockRestore();
  return mirror;
};
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await nextTick();
};
const posts = () => calls.filter((c) => c.method === "POST");

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  opened.cells.length = 0;
  calls = [];
  serverCopy = null;
  attached = [];
  postStatus = 200;
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const status = method === "POST" ? postStatus : 200;
    return { ok: status < 400, status, json: async () => ({ layout: serverCopy, attached }) } as Response;
  }) as unknown as typeof fetch;
});
afterEach(() => vi.useRealTimers());

describe("a grid that loads with its sessions", () => {
  it("does not ask the server, and copies each change to it after a pause", async () => {
    localStorage.setItem("grid_v2", stored([{ session: A, cwd: "/a" }]));
    const mirror = await load();
    const state = mirror.loadGridState();
    expect(calls).toEqual([]);
    mirror.saveGridState(state);
    mirror.saveGridState(state);
    expect(posts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.body).toMatchObject({ layout: { cells: [{ session: A }] } });
  });

  // A full disk refuses the browser's write; the server's copy is exactly what that case needs.
  it("still copies to the server when the browser cannot store it", async () => {
    localStorage.setItem("grid_v2", stored([{ session: A, cwd: "/a" }]));
    const mirror = await load();
    const state = mirror.loadGridState();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mirror.saveGridState(state);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(posts()).toHaveLength(1);
    vi.restoreAllMocks();
  });
});

describe("a copy that did not reach the server", () => {
  const beacons: unknown[] = [];
  beforeEach(() => {
    beacons.length = 0;
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: (_url: string, data: Blob) => beacons.push(data) > 0 });
  });

  // The server's copy would otherwise stay on the previous layout until the next change.
  it("stays pending after a refused POST, so leaving the page sends it", async () => {
    localStorage.setItem("grid_v2", stored([{ session: A, cwd: "/a" }]));
    postStatus = 500;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mirror = await load();
    mirror.saveGridState(mirror.loadGridState());
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(posts()).toHaveLength(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(beacons).toHaveLength(1);
    vi.restoreAllMocks();
  });
});

describe("the legacy key", () => {
  const LEGACY = JSON.stringify({ sessions: [A], cwds: ["/a"], expanded: null });

  it("is dropped once the new key holds its sessions", async () => {
    localStorage.setItem("grid_state_v1", LEGACY);
    const mirror = await load();
    mirror.loadGridState();
    expect(localStorage.getItem("grid_state_v1")).toBeNull();
    expect(localStorage.getItem("grid_v2")).toContain(A);
  });

  // A reload before the server copy lands would otherwise find neither key holding the sessions.
  it("is kept when the browser could not store the new one", async () => {
    localStorage.setItem("grid_state_v1", LEGACY);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mirror = await load();
    mirror.loadGridState();
    vi.restoreAllMocks();
    expect(localStorage.getItem("grid_state_v1")).toBe(LEGACY);
  });
});

describe("a grid that loads with none", () => {
  it("offers the cells of the server's copy that are not shown anywhere", async () => {
    serverCopy = JSON.parse(
      stored([
        { session: A, cwd: "/a" },
        { session: B, cwd: "/b" },
      ]),
    );
    attached = [B];
    const mirror = await load();
    mirror.loadGridState();
    await settle();
    expect(mirror.offeredCells.value?.map((c) => c.session)).toEqual([A]);
  });

  // Its first change would otherwise overwrite the copy it is offering.
  it("holds its writes while the offer is open", async () => {
    serverCopy = JSON.parse(stored([{ session: A, cwd: "/a" }]));
    const mirror = await load();
    const state = mirror.loadGridState();
    await settle();
    mirror.saveGridState(state);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 5);
    expect(posts()).toHaveLength(0);
  });

  it("opens the offered cells on Restore, then copies the grid again", async () => {
    serverCopy = JSON.parse(
      stored([
        { session: A, cwd: "/a" },
        { session: B, cwd: "/b" },
      ]),
    );
    const mirror = await load();
    const state = mirror.loadGridState();
    await settle();
    await mirror.restoreOfferedCells();
    expect(opened.cells).toEqual([expect.objectContaining({ session: A, cwd: "/a" }), expect.objectContaining({ session: B, cwd: "/b" })]);
    expect(mirror.offeredCells.value).toBeNull();
    mirror.saveGridState(state);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(posts()).toHaveLength(1);
  });

  // The bar can sit on screen while another tab opens one of its sessions.
  it("leaves out on Restore a session another tab opened since the offer", async () => {
    serverCopy = JSON.parse(
      stored([
        { session: A, cwd: "/a" },
        { session: B, cwd: "/b" },
      ]),
    );
    const mirror = await load();
    mirror.loadGridState();
    await settle();
    attached = [B];
    await mirror.restoreOfferedCells();
    expect(opened.cells).toEqual([expect.objectContaining({ session: A })]);
  });

  it("opens each cell once however often Restore is pressed", async () => {
    serverCopy = JSON.parse(stored([{ session: A, cwd: "/a" }]));
    const mirror = await load();
    mirror.loadGridState();
    await settle();
    await Promise.all([mirror.restoreOfferedCells(), mirror.restoreOfferedCells()]);
    expect(opened.cells).toHaveLength(1);
  });

  it("opens nothing on Dismiss, and sends the change it held back", async () => {
    serverCopy = JSON.parse(stored([{ session: A, cwd: "/a" }]));
    const mirror = await load();
    const state = mirror.loadGridState();
    await settle();
    mirror.saveGridState(state);
    mirror.dismissOfferedCells();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(opened.cells).toEqual([]);
    expect(mirror.offeredCells.value).toBeNull();
    expect(posts()).toHaveLength(1);
  });

  it("offers nothing and stops holding when the server has no copy", async () => {
    const mirror = await load();
    const state = mirror.loadGridState();
    await settle();
    expect(mirror.offeredCells.value).toBeNull();
    mirror.saveGridState(state);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(posts()).toHaveLength(1);
  });

  it("offers nothing and stops holding when the server cannot be asked", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("offline");
    }) as unknown as typeof fetch;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mirror = await load();
    mirror.loadGridState();
    await settle();
    expect(mirror.offeredCells.value).toBeNull();
    vi.restoreAllMocks();
  });
});

// The last second before the page goes would otherwise never leave it — but a held grid's change
// must not leave it either, or closing the tab overwrites the copy being offered.
describe("leaving the page", () => {
  const beacons: unknown[] = [];
  beforeEach(() => {
    beacons.length = 0;
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: (_url: string, data: Blob) => beacons.push(data) > 0,
    });
  });

  it("sends a change that has not gone yet", async () => {
    localStorage.setItem("grid_v2", stored([{ session: A, cwd: "/a" }]));
    const mirror = await load();
    mirror.saveGridState(mirror.loadGridState());
    window.dispatchEvent(new Event("pagehide"));
    expect(beacons).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(posts()).toHaveLength(0);
  });

  it("sends nothing while the offer is open", async () => {
    serverCopy = JSON.parse(stored([{ session: A, cwd: "/a" }]));
    const mirror = await load();
    const state = mirror.loadGridState();
    await settle();
    mirror.saveGridState(state);
    window.dispatchEvent(new Event("pagehide"));
    expect(beacons).toHaveLength(0);
  });
});
