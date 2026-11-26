import { describe, it, expect, beforeEach, vi } from "vitest";
import { ref, effectScope, nextTick } from "vue";

// Capture the `dir-config` subscriber the composable registers, so a test can play the server.
let publish: ((data: unknown) => void) | null = null;
vi.mock("../../../src/composables/usePubSub", () => ({
  usePubSub: () => ({
    subscribe: (_channel: string, callback: (data: unknown) => void) => {
      publish = callback;
      return () => {};
    },
  }),
}));

import { useDirConfig, useDirPriorities, useDirColors, boundDirCount, invalidateDirConfig } from "../../../src/composables/useDirConfig";
import { TERMINAL_FONT_SIZE_MAX } from "../../../common/terminalFontSize";
import { DIR_ICON_ROUTE } from "../../../common/dirIcon";
import { DIR_BACKGROUND_ROUTE } from "../../../common/dirBackground";
import { dirKeyOf } from "../../../src/composables/dirAddress";

let served = "first";
// Two macrotask hops, not one: a request now resolves through fetchWithTimeout, and its extra
// await pushed the response's own setTimeout(0) behind this helper's (#1393). One hop left the
// assertion running before the answer arrived.
const flush = async () => {
  await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  served = "first";
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ name: served }) })),
  );
});

// Each test uses its OWN directory: the per-cwd fetch cache is module-level and outlives a test.
const serve = (body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })),
  );

// For the set-subscribing composables (useDirPriorities / useDirColors), which fetch one
// directory at a time and have to keep them apart.
const serveByCwd = (byCwd: Record<string, unknown>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      // Base only so a relative /api path parses; nothing is ever requested over it.
      const cwd = decodeURIComponent(new URL(url, "https://test.invalid").searchParams.get("cwd") ?? "");
      return Promise.resolve({ ok: true, json: () => Promise.resolve(byCwd[cwd] ?? {}) });
    }),
  );
const read = async (cwd: string) => {
  const scope = effectScope();
  const config = scope.run(() => useDirConfig(ref(cwd)).config);
  await flush();
  const value = config?.value;
  scope.stop();
  return value;
};

describe("useDirConfig fontSize", () => {
  it("adopts the size the directory pins", async () => {
    serve({ fontSize: 18 });
    expect((await read("/proj/font-pinned"))?.fontSize).toBe(18);
  });

  // The server already clamps, but this parser is the trust boundary — an out-of-range size
  // that slipped through would otherwise reach the canvas renderer unchecked.
  it("re-clamps an out-of-range size off the wire", async () => {
    serve({ fontSize: 999 });
    expect((await read("/proj/font-clamped"))?.fontSize).toBe(TERMINAL_FONT_SIZE_MAX);
  });

  it("stays null when the directory pins nothing, so the Settings value wins", async () => {
    serve({ name: "x" });
    expect((await read("/proj/font-absent"))?.fontSize).toBeNull();
  });

  it("stays null for a non-numeric size rather than guessing", async () => {
    serve({ fontSize: "18" });
    expect((await read("/proj/font-garbage"))?.fontSize).toBeNull();
  });
});

describe("useDirConfig theme", () => {
  it("keeps a built-in id", async () => {
    serve({ theme: "nord" });
    expect((await read("/proj/theme-builtin"))?.theme).toBe("nord");
  });

  // Codex review on #996: the server keeps an id naming a theme the user defined, but this
  // parser dropped everything except the built-ins — so pinning a custom theme in
  // .mulmoterminal.json did nothing, silently, with both halves looking correct on their own.
  it("keeps an id the user defined, which this build cannot enumerate", async () => {
    serve({ theme: "my-dark" });
    expect((await read("/proj/theme-custom"))?.theme).toBe("my-dark");
  });

  it("still drops a shape that could not be a theme id", async () => {
    serve({ theme: "My Dark" });
    expect((await read("/proj/theme-bad-shape"))?.theme).toBeNull();
    serve({ theme: 7 });
    expect((await read("/proj/theme-bad-type"))?.theme).toBeNull();
  });
});

describe("useDirConfig fontFamily", () => {
  it("adopts the stack the directory pins", async () => {
    serve({ fontFamily: "'Cica', monospace" });
    expect((await read("/proj/family-pinned"))?.fontFamily).toBe("'Cica', monospace");
  });

  // Same trust-boundary reasoning as the size above: the server validates, but an unusable stack
  // would otherwise reach the canvas renderer straight off the wire.
  it("re-validates off the wire, falling back rather than passing a broken stack through", async () => {
    serve({ fontFamily: "Cica; color: red" });
    expect((await read("/proj/family-garbage"))?.fontFamily).toBeNull();
  });

  it("stays null when the directory pins nothing, so the global config wins", async () => {
    serve({ name: "x" });
    expect((await read("/proj/family-absent"))?.fontFamily).toBeNull();
  });
});

// The grid's "priority" sort needs a rank for cells on pages that aren't mounted, so this
// subscribes to a whole SET of directories rather than one per mounted cell.
describe("useDirPriorities", () => {
  it("collects the ranks of every directory it is given, mounted or not", async () => {
    serveByCwd({ "/g/a": { orderPriority: 2 }, "/g/b": { orderPriority: 1 }, "/g/c": { name: "no rank" } });
    const scope = effectScope();
    const priorities = scope.run(() => useDirPriorities(ref(["/g/a", "/g/b", "/g/c"])).priorities);
    await flush();
    // /g/c is absent rather than null — "unset" is a lookup miss, which is what the sort reads.
    expect(priorities?.value).toEqual({ "/g/a": 2, "/g/b": 1 });
    scope.stop();
  });

  // The server already rejects a fraction, but this parser is its own trust boundary — and the
  // two disagreeing (finite here, integer there) is what Codex caught on this PR.
  it("reads a fractional rank off the wire as unset, matching the server", async () => {
    serveByCwd({ "/g/frac": { orderPriority: 1.5 }, "/g/int": { orderPriority: 2 } });
    const scope = effectScope();
    const priorities = scope.run(() => useDirPriorities(ref(["/g/frac", "/g/int"])).priorities);
    await flush();
    expect(priorities?.value).toEqual({ "/g/int": 2 });
    scope.stop();
  });

  it("re-reads a directory when the server announces a config write", async () => {
    serveByCwd({ "/g/live": { orderPriority: 5 } });
    const scope = effectScope();
    const priorities = scope.run(() => useDirPriorities(ref(["/g/live"])).priorities);
    await flush();
    expect(priorities?.value["/g/live"]).toBe(5);

    serveByCwd({ "/g/live": { orderPriority: 9 } });
    publish?.({ cwd: "/g/live" });
    await flush();
    expect(priorities?.value["/g/live"]).toBe(9); // re-sorted live, no remount
    scope.stop();
  });

  it("drops a directory that leaves the set, and releases its binding", async () => {
    serveByCwd({ "/g/x": { orderPriority: 1 }, "/g/y": { orderPriority: 2 } });
    const before = boundDirCount();
    const cwds = ref(["/g/x", "/g/y"]);
    const scope = effectScope();
    const priorities = scope.run(() => useDirPriorities(cwds).priorities);
    await flush();
    expect(priorities?.value).toEqual({ "/g/x": 1, "/g/y": 2 });

    expect(boundDirCount()).toBe(before + 2);

    cwds.value = ["/g/x"]; // the cell in /g/y was closed
    await flush();
    expect(priorities?.value).toEqual({ "/g/x": 1 });
    // Asserted HERE, not only after scope.stop(): disposal releases everything anyway, so a
    // check that ran only at the end would pass even if leaving the set released nothing —
    // which is the very thing this test is named for.
    expect(boundDirCount()).toBe(before + 1);

    scope.stop();
    expect(boundDirCount()).toBe(before); // and the survivor goes on disposal
  });
});

// The launch form colours one chip per recent directory, none of which has a cell of its own.
describe("useDirColors", () => {
  it("resolves each directory to one colour, and omits the ones that set none", async () => {
    serveByCwd({
      "/c/header": { headerColor: "#112233", badgeColor: "#445566" },
      "/c/badge": { badgeColor: "#445566" },
      "/c/plain": { name: "no colour" },
    });
    const scope = effectScope();
    const colors = scope.run(() => useDirColors(ref(["/c/header", "/c/badge", "/c/plain"])).colors);
    await flush();
    expect(colors?.value).toEqual({ "/c/header": "#112233", "/c/badge": "#445566" });
    scope.stop();
  });

  it("recolours a chip when the server announces a config write", async () => {
    serveByCwd({ "/c/live": { headerColor: "#112233" } });
    const scope = effectScope();
    const colors = scope.run(() => useDirColors(ref(["/c/live"])).colors);
    await flush();
    expect(colors?.value["/c/live"]).toBe("#112233");

    serveByCwd({ "/c/live": { headerColor: "#998877" } });
    publish?.({ cwd: "/c/live" });
    await flush();
    expect(colors?.value["/c/live"]).toBe("#998877");
    scope.stop();
  });

  // Codex on #951: the first read for a directory could land AFTER a config write had already
  // pushed a newer value through the invalidation fan-out, reverting the colour to the old one.
  // Saving .mulmoterminal.json twice in a row is all it takes.
  it("drops a first read that resolves after a config write already delivered a newer value", async () => {
    // The FIRST read (from track) is held open; the invalidation's read answers immediately.
    let release!: (body: unknown) => void;
    const heldFirstRead = new Promise<unknown>((resolve) => {
      release = (body) => resolve({ ok: true, json: () => Promise.resolve(body) });
    });
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        call += 1;
        return call === 1 ? heldFirstRead : Promise.resolve({ ok: true, json: () => Promise.resolve({ headerColor: "#222222" }) });
      }),
    );

    const scope = effectScope();
    const colors = scope.run(() => useDirColors(ref(["/c/race"])).colors);
    await flush();

    publish?.({ cwd: "/c/race" }); // the server saw a write while the first read was in flight
    await flush();
    expect(colors?.value["/c/race"]).toBe("#222222");

    release({ headerColor: "#111111" }); // ...and now the stale first read finally answers
    await flush();
    expect(colors?.value["/c/race"]).toBe("#222222"); // not reverted
    scope.stop();
  });

  // The launch form hands over an empty list once the cell launches, and the chips' fetches
  // must stop with them rather than outliving the form for the rest of the session.
  it("releases a directory that leaves the set", async () => {
    serveByCwd({ "/c/gone": { headerColor: "#112233" } });
    const before = boundDirCount();
    const cwds = ref(["/c/gone"]);
    const scope = effectScope();
    const colors = scope.run(() => useDirColors(cwds).colors);
    await flush();
    expect(boundDirCount()).toBe(before + 1);

    cwds.value = [];
    await flush();
    expect(colors?.value).toEqual({});
    expect(boundDirCount()).toBe(before);
    scope.stop();
  });
});

describe("useDirConfig live reload", () => {
  it("re-reads the directory when the server announces a change, without remounting", async () => {
    const scope = effectScope();
    const config = scope.run(() => useDirConfig(ref("/proj/a")).config);
    await flush();
    expect(config?.value.name).toBe("first");

    served = "second";
    publish?.({ cwd: "/proj/a" }); // the server saw a write to /proj/a/.mulmoterminal.json
    await flush();
    expect(config?.value.name).toBe("second");
    scope.stop();
  });

  // Each test uses its own directory: the per-cwd fetch cache is module-level and outlives a test.
  it("ignores an announcement for a directory nothing is showing", async () => {
    const scope = effectScope();
    const config = scope.run(() => useDirConfig(ref("/proj/b")).config);
    await flush();

    served = "second";
    publish?.({ cwd: "/proj/other" });
    await flush();
    expect(config?.value.name).toBe("first"); // untouched
    scope.stop();
  });

  it("unbinds on scope dispose and leaves no empty entry behind", async () => {
    const before = boundDirCount();
    const scope = effectScope();
    const config = scope.run(() => useDirConfig(ref("/proj/leaky")).config);
    await flush();
    expect(boundDirCount()).toBe(before + 1);

    scope.stop();
    expect(boundDirCount()).toBe(before); // the key is gone, not just the callback

    served = "second";
    invalidateDirConfig("/proj/leaky"); // a closed cell must not keep receiving updates
    await flush();
    expect(config?.value.name).toBe("first");
  });

  // Two writes in quick succession start overlapping requests; if the older response lands last it
  // must not overwrite the newer config.
  it("never lets a slow older response overwrite a newer one", async () => {
    const plan = [
      { name: "first", delay: 0 },
      { name: "older", delay: 60 },
      { name: "newer", delay: 5 },
    ];
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        const { name, delay } = plan[call++];
        return Promise.resolve({ ok: true, json: () => new Promise((r) => setTimeout(() => r({ name }), delay)) });
      }),
    );

    const scope = effectScope();
    const config = scope.run(() => useDirConfig(ref("/proj/race")).config);
    await flush();
    expect(config?.value.name).toBe("first");

    invalidateDirConfig("/proj/race"); // write A -> slow response "older"
    invalidateDirConfig("/proj/race"); // write B -> fast response "newer"
    await new Promise((r) => setTimeout(r, 120)); // let BOTH settle, slow one last

    expect(config?.value.name).toBe("newer");
    scope.stop();
  });

  it("seeds a re-mounted cell from cache so it never flashes the default palette", async () => {
    // First mount fetches and caches /proj/seed's config.
    const s1 = effectScope();
    const c1 = s1.run(() => useDirConfig(ref("/proj/seed")).config);
    await flush();
    expect(c1?.value.name).toBe("first");
    s1.stop();

    // A tab switch remounts the cell. The config must be present on the FIRST synchronous
    // frame — before any fetch/await settles — so the terminal paints the dir palette
    // immediately instead of the default one. (Pre-fix this was EMPTY until a flush.)
    const s2 = effectScope();
    const c2 = s2.run(() => useDirConfig(ref("/proj/seed")).config);
    expect(c2?.value.name).toBe("first"); // no flush
    s2.stop();
  });

  it("releases the old directory when a cell switches cwd", async () => {
    const before = boundDirCount();
    const cwd = ref("/proj/one");
    const scope = effectScope();
    scope.run(() => useDirConfig(cwd).config);
    await flush();
    expect(boundDirCount()).toBe(before + 1);

    cwd.value = "/proj/two";
    await flush();
    expect(boundDirCount()).toBe(before + 1); // one released, one acquired — not two

    scope.stop();
    expect(boundDirCount()).toBe(before);
  });
});

// A remote directory is read through the gateway (#3506). Its own icon, background and sound are
// this server's routes naming the remote's path, so they are dropped; a web URL is kept.
describe("useDirConfig on a remote directory", () => {
  const SERVED_HERE = {
    name: "remote",
    iconUrl: `${DIR_ICON_ROUTE}?cwd=%2Fsrv%2Fp`,
    backgroundImage: { url: `${DIR_BACKGROUND_ROUTE}?cwd=%2Fsrv%2Fp`, opacity: 0.5, fit: "cover" },
    hasSound: true,
  };

  it("asks the host, and drops what this server would serve", async () => {
    serve(SERVED_HERE);
    const config = await read(dirKeyOf("lx", "/srv/remote-assets") ?? "");
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url))).toEqual(["/remote/lx/api/dir-config?cwd=%2Fsrv%2Fremote-assets"]);
    expect(config).toMatchObject({ name: "remote", iconUrl: null, backgroundImage: null, hasSound: false });
  });

  it("keeps a web icon and background", async () => {
    const web = "https://example.com/icon.png";
    serve({ ...SERVED_HERE, iconUrl: web, backgroundImage: { url: web, opacity: 0.5, fit: "cover" } });
    const config = await read(dirKeyOf("lx", "/srv/remote-web") ?? "");
    expect(config?.iconUrl).toBe(web);
    expect(config?.backgroundImage?.url).toBe(web);
  });

  it("keeps all of it for the same answer on a local directory", async () => {
    serve(SERVED_HERE);
    const config = await read("/srv/local-assets");
    expect(config).toMatchObject({ iconUrl: SERVED_HERE.iconUrl, hasSound: true });
    expect(config?.backgroundImage?.url).toBe(SERVED_HERE.backgroundImage.url);
  });
});
