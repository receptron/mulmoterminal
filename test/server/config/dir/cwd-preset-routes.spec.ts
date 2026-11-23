// @vitest-environment node
//
// Recording a working directory is a ONE-ENTRY mutation applied to the file, not a replace-all.
//
// This is a data-loss fix, so what these pin is mostly what must NOT happen: `cwdPresets` is
// global (every mulmoterminal on the machine shares the file) and it decides which projects the
// server serves collections for. A client that sent the whole list sent its own view of it, and
// on 2026-08-09 a terminal launched during the initial GET reduced five saved directories to one.
// The routes below exist so the caller never holds the list at all.
import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { MISSING_CONFIRM_MS } from "../../../../server/config/dir/missing-presets";
import express from "express";
import { routeCall, jsonPost } from "../../../helpers/routeCall";
import { isRecord } from "../../../../common/isRecord";
import { tmpdir } from "node:os";
import path from "node:path";

const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function mountAgainstTempHome(initial: Record<string, unknown>) {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-preset-routes-"));
  dirs.push(dir);
  vi.stubEnv("HOME", dir);
  vi.stubEnv("USERPROFILE", dir);
  // WRITTEN BEFORE THE IMPORT, because that is the order production has: the module reads the
  // file once at load and serves that list until something writes. A fixture that writes it
  // afterwards leaves the module's view empty while the disk is full — a state the server is
  // never in, and one that makes the "did the list THIS process serves move?" comparison look
  // wrong when it is right.
  mkdirSync(path.join(dir, ".mulmoterminal"), { recursive: true });
  writeFileSync(path.join(dir, ".mulmoterminal", "config.json"), JSON.stringify(initial, null, 2));
  vi.resetModules();
  const { mountConfigRoutes, APP_CONFIG_FILE } = await import("../../../../server/config/config-routes.js");
  // Guard: a stub that did not take would have targeted the real config.
  expect(APP_CONFIG_FILE.startsWith(dir), "config path must be inside the temp HOME").toBe(true);

  const onChanged = vi.fn();
  const app = express();
  app.use(express.json());
  mountConfigRoutes(app, dir, onChanged);
  const onDisk = () => JSON.parse(readFileSync(APP_CONFIG_FILE, "utf8"));
  return { app, onChanged, onDisk };
}

// Through `path.resolve`, never as POSIX literals: the route canonicalises the path it records,
// and that drive-qualifies on Windows (`D:\\srv\\mag2`), so a literal expectation matches only off
// Windows. See docs/windows-gotchas.md, "Tests that handle paths".
const at = (posixPath: string) => path.resolve(posixPath);
const MAG2 = at("/srv/mag2");
const SITE = at("/srv/site");
const NEW = at("/srv/new");
const NEVER = at("/srv/never");
const A = at("/a");
const B = at("/b");
const ALPHA = at("/home/me/alpha");

const TWO = [
  { label: "mag2", path: MAG2 },
  { label: "site", path: SITE },
];

/** The saved directories the route answered with, read through a guard. */
const pathsOf = (body: Record<string, unknown>): unknown[] => {
  const presets = body.cwdPresets;
  if (!Array.isArray(presets)) throw new Error(`no cwdPresets in ${JSON.stringify(body)}`);
  return presets.map((preset: unknown) => (isRecord(preset) ? preset.path : preset));
};

describe("POST /api/config/cwd-presets/record", () => {
  it("adds one entry and KEEPS every other, whatever the caller knows", async () => {
    const { app, onDisk } = await mountAgainstTempHome({ cwdPresets: TWO });
    const res = await routeCall(app)("/api/config/cwd-presets/record", jsonPost({ path: NEW, label: "new" }));
    expect(res.status).toBe(200);
    // The caller sent ONE path. It could not have deleted the others if it tried.
    expect(pathsOf(res.body)).toEqual([NEW, MAG2, SITE]);
    expect(onDisk().cwdPresets).toHaveLength(3);
  });

  it("bumps an existing directory to the front, keeping the label the user gave it", async () => {
    const { app } = await mountAgainstTempHome({
      cwdPresets: [
        { label: "two", path: B },
        { label: "Custom", path: A },
      ],
    });
    const res = await routeCall(app)("/api/config/cwd-presets/record", jsonPost({ path: A, label: "a" }));
    expect(res.body.cwdPresets).toEqual([
      { label: "Custom", path: A },
      { label: "two", path: B },
    ]);
  });

  it("falls back to the basename when no label is sent", async () => {
    const { app } = await mountAgainstTempHome({});
    const res = await routeCall(app)("/api/config/cwd-presets/record", jsonPost({ path: ALPHA }));
    expect(res.body.cwdPresets).toEqual([{ label: "alpha", path: ALPHA }]);
  });

  it("keeps every OTHER setting in the file", async () => {
    const { app, onDisk } = await mountAgainstTempHome({ cwdPresets: TWO, pushEnabled: true, futureFeature: "on" });
    await routeCall(app)("/api/config/cwd-presets/record", jsonPost({ path: NEW }));
    const saved = onDisk();
    expect(saved.pushEnabled).toBe(true);
    // Including a key THIS build does not know — another version's setting must not vanish (#966).
    expect(saved.futureFeature).toBe("on");
  });

  it("refuses a request with no path", async () => {
    const { app, onDisk } = await mountAgainstTempHome({ cwdPresets: TWO });
    expect((await routeCall(app)("/api/config/cwd-presets/record", jsonPost({}))).status).toBe(400);
    expect((await routeCall(app)("/api/config/cwd-presets/record", jsonPost({ path: "   " }))).status).toBe(400);
    expect(onDisk().cwdPresets).toHaveLength(2);
  });

  // A single stray comma must not cost the user the rest of their settings — the same refusal
  // POST /api/config makes.
  it("refuses to write over a config it could not parse", async () => {
    const { app } = await mountAgainstTempHome({});
    const { APP_CONFIG_FILE } = await import("../../../../server/config/config-routes.js");
    writeFileSync(APP_CONFIG_FILE, "{ not json");
    const res = await routeCall(app)("/api/config/cwd-presets/record", jsonPost({ path: NEW }));
    expect(res.status).toBe(409);
  });

  it("tells the caller the project list moved, so the collection watchers can follow", async () => {
    const { app, onChanged } = await mountAgainstTempHome({ cwdPresets: TWO });
    await routeCall(app)("/api/config/cwd-presets/record", jsonPost({ path: NEW }));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the directory was already at the front", async () => {
    const { app, onChanged } = await mountAgainstTempHome({ cwdPresets: TWO });
    await routeCall(app)("/api/config/cwd-presets/record", jsonPost({ path: MAG2 }));
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe("POST /api/config/cwd-presets/remove", () => {
  it("drops one entry and keeps the rest", async () => {
    const { app, onDisk } = await mountAgainstTempHome({ cwdPresets: TWO });
    const res = await routeCall(app)("/api/config/cwd-presets/remove", jsonPost({ path: MAG2 }));
    expect(res.body.cwdPresets).toEqual([{ label: "site", path: SITE }]);
    expect(onDisk().cwdPresets).toHaveLength(1);
  });

  it("is a no-op for a path that is not saved, and says nothing changed", async () => {
    const { app, onChanged } = await mountAgainstTempHome({ cwdPresets: TWO });
    const res = await routeCall(app)("/api/config/cwd-presets/remove", jsonPost({ path: NEVER }));
    expect(res.body.cwdPresets).toHaveLength(2);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("refuses a request with no path", async () => {
    const { app } = await mountAgainstTempHome({ cwdPresets: TWO });
    expect((await routeCall(app)("/api/config/cwd-presets/remove", jsonPost({}))).status).toBe(400);
  });
});

// #3414: a deleted directory leaves the list; one whose parent is gone too (an unmounted drive looks
// like that) is kept on disk and only named, so the launcher can hide it until it comes back.
describe("POST /api/config/cwd-presets/prune-missing", () => {
  const missingSincePath = () => path.join(process.env.HOME ?? "", ".mulmoterminal", "missing-dirs.json");
  const missingSince = (): Record<string, number> => (existsSync(missingSincePath()) ? JSON.parse(readFileSync(missingSincePath(), "utf8")) : {});
  const writeMissingSince = (record: Record<string, number>) => writeFileSync(missingSincePath(), JSON.stringify(record));

  function scratchTree() {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "mt-prune-")));
    dirs.push(root);
    const kept = path.join(root, "kept");
    mkdirSync(kept);
    return { kept, deleted: path.join(root, "deleted"), unmounted: path.join(root, "volume", "project") };
  }

  it("hides a deleted directory at first sight, records when, and keeps it in config.json", async () => {
    const { kept, deleted, unmounted } = scratchTree();
    const saved = [kept, deleted, unmounted].map((dir) => ({ label: path.basename(dir), path: dir }));
    const { app, onDisk, onChanged } = await mountAgainstTempHome({ cwdPresets: saved });
    const before = Date.now();
    const res = await routeCall(app)("/api/config/cwd-presets/prune-missing", jsonPost({}));
    expect(res.status).toBe(200);
    expect(pathsOf(res.body)).toEqual([kept, deleted, unmounted]);
    expect(res.body.unreachable).toEqual([deleted, unmounted]);
    expect(onDisk().cwdPresets).toHaveLength(3);
    const since = missingSince()[deleted];
    expect(since).toBeGreaterThanOrEqual(before);
    expect(Object.keys(missingSince())).toEqual([deleted]); // the unreachable one is never on the clock
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("forgets it once a check a day later still finds it missing, keeping everything else", async () => {
    const { kept, deleted, unmounted } = scratchTree();
    const saved = [kept, deleted, unmounted].map((dir) => ({ label: path.basename(dir), path: dir }));
    const { app, onDisk, onChanged } = await mountAgainstTempHome({ cwdPresets: saved, pushEnabled: true });
    writeMissingSince({ [deleted]: Date.now() - MISSING_CONFIRM_MS - 1 });
    const res = await routeCall(app)("/api/config/cwd-presets/prune-missing", jsonPost({}));
    expect(pathsOf(res.body)).toEqual([kept, unmounted]);
    expect(res.body.unreachable).toEqual([unmounted]);
    expect(onDisk().cwdPresets.map((preset: { path: string }) => preset.path)).toEqual([kept, unmounted]);
    expect(onDisk().pushEnabled).toBe(true);
    expect(onChanged).toHaveBeenCalledTimes(1);
    // Its time is dropped on the next check, once the entry has left the list.
    await routeCall(app)("/api/config/cwd-presets/prune-missing", jsonPost({}));
    expect(missingSince()).toEqual({});
  });

  // A record that was not written may hold a time the directory has since reset, so it must not
  // confirm anything: everything suspected is hidden, nothing is removed.
  it("removes nothing when the first-seen record cannot be written", async () => {
    const { kept, deleted } = scratchTree();
    const saved = [kept, deleted].map((dir) => ({ label: path.basename(dir), path: dir }));
    vi.doMock("../../../../server/config/dir/cwd-presets", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../../../server/config/dir/cwd-presets")>()),
      saveMissingSince: () => false,
    }));
    try {
      const { app, onDisk, onChanged } = await mountAgainstTempHome({ cwdPresets: saved });
      writeMissingSince({ [deleted]: Date.now() - MISSING_CONFIRM_MS - 1 });
      const res = await routeCall(app)("/api/config/cwd-presets/prune-missing", jsonPost({}));
      expect(res.status).toBe(200);
      expect(pathsOf(res.body)).toEqual([kept, deleted]);
      expect(res.body.unreachable).toEqual([deleted]);
      expect(onDisk().cwdPresets).toHaveLength(2);
      expect(onChanged).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("../../../../server/config/dir/cwd-presets");
    }
  });

  it("keeps waiting when the second check comes less than a day later", async () => {
    const { kept, deleted } = scratchTree();
    const saved = [kept, deleted].map((dir) => ({ label: path.basename(dir), path: dir }));
    const { app, onDisk } = await mountAgainstTempHome({ cwdPresets: saved });
    const firstSeen = Date.now() - MISSING_CONFIRM_MS + 60_000;
    writeMissingSince({ [deleted]: firstSeen });
    const res = await routeCall(app)("/api/config/cwd-presets/prune-missing", jsonPost({}));
    expect(res.body.unreachable).toEqual([deleted]);
    expect(onDisk().cwdPresets).toHaveLength(2);
    expect(missingSince()).toEqual({ [deleted]: firstSeen });
  });

  it("starts the clock again for a directory that came back", async () => {
    const { kept } = scratchTree();
    const { app } = await mountAgainstTempHome({ cwdPresets: [{ label: "kept", path: kept }] });
    writeMissingSince({ [kept]: Date.now() - MISSING_CONFIRM_MS - 1 });
    const res = await routeCall(app)("/api/config/cwd-presets/prune-missing", jsonPost({}));
    expect(pathsOf(res.body)).toEqual([kept]);
    expect(missingSince()).toEqual({});
  });

  it("writes nothing when nothing was deleted", async () => {
    const { kept, unmounted } = scratchTree();
    const saved = [kept, unmounted].map((dir) => ({ label: path.basename(dir), path: dir }));
    const { app, onChanged } = await mountAgainstTempHome({ cwdPresets: saved });
    const { APP_CONFIG_FILE } = await import("../../../../server/config/config-routes.js");
    const before = readFileSync(APP_CONFIG_FILE, "utf8");
    const res = await routeCall(app)("/api/config/cwd-presets/prune-missing", jsonPost({}));
    expect(pathsOf(res.body)).toEqual([kept, unmounted]);
    expect(res.body.unreachable).toEqual([unmounted]);
    expect(readFileSync(APP_CONFIG_FILE, "utf8")).toBe(before);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === "win32")("keeps a symlink whose target is missing, and names it", async () => {
    const { kept } = scratchTree();
    const link = path.join(path.dirname(kept), "usb-link");
    symlinkSync(path.join(path.dirname(kept), "unmounted"), link);
    const saved = [kept, link].map((dir) => ({ label: path.basename(dir), path: dir }));
    const { app, onDisk } = await mountAgainstTempHome({ cwdPresets: saved });
    const res = await routeCall(app)("/api/config/cwd-presets/prune-missing", jsonPost({}));
    expect(pathsOf(res.body)).toEqual([kept, link]);
    expect(res.body.unreachable).toEqual([link]);
    expect(onDisk().cwdPresets).toHaveLength(2);
  });

  // An empty answer would be adopted as the whole list, and every chip would vanish.
  it("refuses an unreadable config instead of answering it as empty, and leaves the file alone", async () => {
    const { app } = await mountAgainstTempHome({});
    const { APP_CONFIG_FILE } = await import("../../../../server/config/config-routes.js");
    writeFileSync(APP_CONFIG_FILE, "{ not json");
    const res = await routeCall(app)("/api/config/cwd-presets/prune-missing", jsonPost({}));
    expect(res.status).toBe(409);
    expect(readFileSync(APP_CONFIG_FILE, "utf8")).toBe("{ not json");
  });

  // Another process wrote the file since this one loaded it. The answer is adopted by the client as
  // the whole list, so this process must start serving the same list.
  it("brings this process's own view in line with the file it answered from", async () => {
    const { kept } = scratchTree();
    const { app, onChanged } = await mountAgainstTempHome({ cwdPresets: [] });
    const { APP_CONFIG_FILE, getCwdPresets } = await import("../../../../server/config/config-routes.js");
    writeFileSync(APP_CONFIG_FILE, JSON.stringify({ cwdPresets: [{ label: "kept", path: kept }] }));
    expect(getCwdPresets()).toEqual([]);
    const res = await routeCall(app)("/api/config/cwd-presets/prune-missing", jsonPost({}));
    expect(pathsOf(res.body)).toEqual([kept]);
    expect(getCwdPresets().map((preset) => preset.path)).toEqual([kept]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("answers an empty list for a config with no saved directories", async () => {
    const { app } = await mountAgainstTempHome({});
    const res = await routeCall(app)("/api/config/cwd-presets/prune-missing", jsonPost({}));
    expect(res.body).toEqual({ cwdPresets: [], unreachable: [] });
  });
});
