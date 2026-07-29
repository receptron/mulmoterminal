import { describe, it, expect, vi } from "vitest";
import { makeTempDir } from "../../support/tempDir.js";
import { writeFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import {
  resolveDirSound,
  loadDirConfig,
  publicDirConfig,
  dirSoundFor,
  dirConfigWriteTarget,
  dirConfigDetail,
  MISSING_DIR_CONFIG_DETAIL,
} from "../../../server/config/dir-config";
import { DIR_CONFIG_KEYS } from "../../../common/dirConfigSource";
import { resolveWorkspace } from "../../../server/config/workspace";

const tmp = () => makeTempDir("mt-dircfg-");
const EMPTY = {
  name: null,
  badgeColor: null,
  headerColor: null,
  headerTextColor: null,
  cellColor: null,
  cellBorderColor: null,
  dotColor: null,
  buttonColor: null,
  fontSize: null,
  fontFamily: null,
  orderPriority: null,
  theme: null,
  colors: null,
  sound: null,
  sounds: {},
  buttons: null,
  chips: null,
  skills: null,
  provider: null,
  model: null,
  addDirs: null,
  appendSystemPrompt: null,
};

function withConfig(body: unknown): { dir: string; cleanup: () => void } {
  const dir = tmp();
  writeFileSync(path.join(dir, ".mulmoterminal.json"), typeof body === "string" ? body : JSON.stringify(body));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("resolveDirSound", () => {
  it("resolves a relative path to an existing file inside cwd", () => {
    const { dir, cleanup } = withConfig({});
    writeFileSync(path.join(dir, "alert.mp3"), "x");
    expect(resolveDirSound(dir, "./alert.mp3")).toBe(path.join(dir, "alert.mp3"));
    expect(resolveDirSound(dir, "alert.mp3")).toBe(path.join(dir, "alert.mp3"));
    cleanup();
  });

  it("allows a file in a subdirectory of cwd", () => {
    const { dir, cleanup } = withConfig({});
    mkdirSync(path.join(dir, "sounds"));
    writeFileSync(path.join(dir, "sounds", "a.wav"), "x");
    expect(resolveDirSound(dir, "sounds/a.wav")).toBe(path.join(dir, "sounds", "a.wav"));
    cleanup();
  });

  it("rejects absolute paths", () => {
    const { dir, cleanup } = withConfig({});
    writeFileSync(path.join(dir, "a.mp3"), "x");
    expect(resolveDirSound(dir, path.join(dir, "a.mp3"))).toBeNull();
    cleanup();
  });

  it("rejects traversal that escapes cwd even when the target exists", () => {
    const parent = tmp();
    const dir = path.join(parent, "project");
    mkdirSync(dir);
    writeFileSync(path.join(parent, "secret.mp3"), "x"); // exists, but OUTSIDE the dir
    expect(resolveDirSound(dir, "../secret.mp3")).toBeNull();
    rmSync(parent, { recursive: true, force: true });
  });

  it("rejects a sibling dir sharing a name prefix (no boundary bypass)", () => {
    const parent = tmp();
    const dir = path.join(parent, "app");
    const sibling = path.join(parent, "app-evil");
    mkdirSync(dir);
    mkdirSync(sibling);
    writeFileSync(path.join(sibling, "a.mp3"), "x");
    expect(resolveDirSound(dir, "../app-evil/a.mp3")).toBeNull();
    rmSync(parent, { recursive: true, force: true });
  });

  it("rejects a symlink inside cwd that points outside it", () => {
    const parent = tmp();
    const dir = path.join(parent, "project");
    mkdirSync(dir);
    writeFileSync(path.join(parent, "outside.mp3"), "x"); // target lives OUTSIDE the dir
    symlinkSync(path.join(parent, "outside.mp3"), path.join(dir, "link.mp3"));
    expect(resolveDirSound(dir, "./link.mp3")).toBeNull();
    rmSync(parent, { recursive: true, force: true });
  });

  it("allows a symlink that still resolves inside cwd", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "real.mp3"), "x");
    symlinkSync(path.join(dir, "real.mp3"), path.join(dir, "link.mp3"));
    expect(resolveDirSound(dir, "./link.mp3")).toBe(path.join(dir, "link.mp3"));
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null for a missing file or non-string input", () => {
    const { dir, cleanup } = withConfig({});
    expect(resolveDirSound(dir, "./missing.mp3")).toBeNull();
    expect(resolveDirSound(dir, "")).toBeNull();
    expect(resolveDirSound(dir, 42)).toBeNull();
    expect(resolveDirSound(dir, null)).toBeNull();
    cleanup();
  });
});

describe("loadDirConfig", () => {
  it("loads and sanitizes a full config", () => {
    const { dir, cleanup } = withConfig({
      name: "  PROD  ",
      badgeColor: "#CF222E",
      headerColor: "#190A23",
      headerTextColor: "#FFFFFF",
      cellColor: "#101014",
      cellBorderColor: "#2A2A4E",
      dotColor: "#00E676",
      buttonColor: "#C7CDF0",
      fontSize: 17,
      fontFamily: "'Cica', monospace",
      orderPriority: 5,
      theme: "nord",
      sound: "./a.mp3",
      skills: ["  review  ", "commit", "review", ""],
      appendSystemPrompt: false,
    });
    writeFileSync(path.join(dir, "a.mp3"), "x");
    expect(loadDirConfig(dir)).toEqual({
      name: "PROD",
      badgeColor: "#cf222e",
      headerColor: "#190a23",
      headerTextColor: "#ffffff",
      cellColor: "#101014",
      cellBorderColor: "#2a2a4e",
      dotColor: "#00e676",
      buttonColor: "#c7cdf0",
      fontSize: 17,
      fontFamily: "'Cica', monospace",
      orderPriority: 5,
      theme: "nord",
      colors: null,
      sound: path.join(dir, "a.mp3"),
      sounds: {},
      buttons: null,
      chips: null,
      skills: ["review", "commit"], // trimmed, deduped, empties dropped
      provider: null,
      model: null,
      addDirs: null,
      appendSystemPrompt: false,
    });
    cleanup();
  });

  it("nulls the skills filter when absent, empty, or not an array of strings", () => {
    const absent = withConfig({ name: "x" });
    expect(loadDirConfig(absent.dir).skills).toBeNull();
    absent.cleanup();
    const empty = withConfig({ skills: ["", "  "] });
    expect(loadDirConfig(empty.dir).skills).toBeNull();
    empty.cleanup();
    const garbage = withConfig({ skills: "review" });
    expect(loadDirConfig(garbage.dir).skills).toBeNull();
    garbage.cleanup();
  });

  it("drops malformed header colors (hex #rrggbb only)", () => {
    const { dir, cleanup } = withConfig({ headerColor: "red", headerTextColor: "#fff" });
    const cfg = loadDirConfig(dir);
    expect(cfg.headerColor).toBeNull(); // not #rrggbb
    expect(cfg.headerTextColor).toBeNull(); // shorthand not accepted
    cleanup();
  });

  it("keeps known palette colors and drops unknown keys / bad values", () => {
    const { dir, cleanup } = withConfig({
      colors: { background: "#190A23", cursor: "#FFF", foreground: "rgb(1,2,3)", bogus: "#000000", red: "# abc" },
    });
    expect(loadDirConfig(dir).colors).toEqual({ background: "#190a23", cursor: "#fff" });
    cleanup();
  });

  it("nulls a colors block with nothing valid", () => {
    const { dir, cleanup } = withConfig({ colors: { nope: "#fff", foreground: "red" } });
    expect(loadDirConfig(dir).colors).toBeNull();
    cleanup();
  });

  it("caps an overlong name", () => {
    const { dir, cleanup } = withConfig({ name: "x".repeat(100) });
    expect(loadDirConfig(dir).name).toHaveLength(40);
    cleanup();
  });

  // A theme id naming neither a built-in nor a configured custom theme is a typo. Dropping it
  // is what puts the key in the "ignored" list Settings shows — kept, it would paint the default
  // and look like the setting was never made (#996).
  it("drops an unknown theme and a malformed color", () => {
    const { dir, cleanup } = withConfig({ theme: "neon", badgeColor: "red" });
    expect(loadDirConfig(dir)).toEqual(EMPTY);
    cleanup();
  });

  // The other half of the same rule: an id the user actually defined in the global config's
  // `themes` is a real theme, and a directory may pin it (#996).
  it("keeps a theme id the global config defines", async () => {
    const routes = await import("../../../server/config/config-routes");
    const spy = vi.spyOn(routes, "getCustomThemeIds").mockReturnValue(["my-dark"]);
    const { dir, cleanup } = withConfig({ theme: "my-dark" });
    expect(loadDirConfig(dir).theme).toBe("my-dark");
    spy.mockRestore();
    cleanup();
  });

  it("returns all-null for a missing file", () => {
    const dir = tmp();
    expect(loadDirConfig(dir)).toEqual(EMPTY);
    rmSync(dir, { recursive: true, force: true });
  });

  // #1062. A tri-state, unlike the global boolean it overrides: null is what makes "this file
  // says nothing, follow the global setting" different from an explicit `false`.
  describe("appendSystemPrompt", () => {
    it.each([
      ["false", false, false],
      ["true", true, true],
    ])("keeps an explicit %s", (_case, written, expected) => {
      const { dir, cleanup } = withConfig({ appendSystemPrompt: written });
      expect(loadDirConfig(dir).appendSystemPrompt).toBe(expected);
      cleanup();
    });

    // A string is the planned third value but is not accepted yet, so it has to read as "unset"
    // — which puts the key in the "ignored" list Settings shows, rather than silently meaning off.
    it.each([
      ["a string", "off"],
      ["a number", 0],
      ["absent", undefined],
    ])("reads %s as unset", (_case, written) => {
      const { dir, cleanup } = withConfig({ appendSystemPrompt: written });
      expect(loadDirConfig(dir).appendSystemPrompt).toBeNull();
      cleanup();
    });
  });

  it("returns all-null for invalid JSON or a non-object", () => {
    const bad = withConfig("{ not json");
    expect(loadDirConfig(bad.dir)).toEqual(EMPTY);
    bad.cleanup();
    const arr = withConfig([1, 2, 3]);
    expect(loadDirConfig(arr.dir)).toEqual(EMPTY);
    arr.cleanup();
  });
});

describe("dirConfigWriteTarget", () => {
  // Built through `path` so inputs and expectations carry the running platform's drive
  // and separators — the function returns path.resolve()'d dirs, which on Windows are
  // `D:\...` with backslashes, not POSIX literals.
  const projDir = path.resolve("/Users/me/proj");
  const file = path.join(projDir, ".mulmoterminal.json");

  it("returns the directory for each file-writing tool", () => {
    for (const tool of ["Write", "Edit", "MultiEdit"]) {
      expect(dirConfigWriteTarget(tool, { file_path: file })).toBe(projDir);
    }
  });

  // #1002 — the invariant the live reload rests on: the cwd ANNOUNCED when a .mulmoterminal.json
  // is written has to be the same STRING as the cwd the cell showing that directory is keyed by.
  // The two are produced by different code (path.dirname here, the workspace guard there) and are
  // matched by exact equality on the client, so nothing but this keeps them spelled the same.
  // A directory launched as `/a/b/` — what a shell's tab-completion leaves in the launch form —
  // was announced as `/a/b`, and the cell never heard about its own config file.
  it("announces the same cwd string the workspace guard hands the cell", () => {
    const dir = tmp();
    const launchedAs = dir + path.sep;
    const announced = dirConfigWriteTarget("Write", { file_path: path.join(dir, ".mulmoterminal.json") }, launchedAs);
    expect(announced).toBe(resolveWorkspace(launchedAs));
    expect(announced).toBe(dir);
  });

  it("resolves a relative path against the SESSION cwd, not the server's", () => {
    expect(dirConfigWriteTarget("Write", { file_path: ".mulmoterminal.json" }, projDir)).toBe(projDir);
    expect(dirConfigWriteTarget("Write", { file_path: path.join("sub", ".mulmoterminal.json") }, projDir)).toBe(path.join(projDir, "sub"));
  });

  it("publishes nothing for a relative path when the session cwd is unknown", () => {
    // Resolving against process.cwd() would invalidate the wrong dir AND miss the real one.
    expect(dirConfigWriteTarget("Write", { file_path: ".mulmoterminal.json" })).toBeNull();
    expect(dirConfigWriteTarget("Write", { file_path: ".mulmoterminal.json" }, null)).toBeNull();
  });

  it("ignores the session cwd for an absolute path", () => {
    expect(dirConfigWriteTarget("Write", { file_path: file }, path.resolve("/somewhere/else"))).toBe(projDir);
  });

  it("ignores tools that don't write the file", () => {
    expect(dirConfigWriteTarget("Read", { file_path: file })).toBeNull();
    expect(dirConfigWriteTarget("Bash", { command: `echo x > ${file}` })).toBeNull();
  });

  it("ignores writes to any other file", () => {
    expect(dirConfigWriteTarget("Write", { file_path: "/Users/me/proj/package.json" })).toBeNull();
    expect(dirConfigWriteTarget("Write", { file_path: "/Users/me/.mulmoterminal.json.bak" })).toBeNull();
  });

  it("returns null for malformed payloads", () => {
    expect(dirConfigWriteTarget("Write", null)).toBeNull();
    expect(dirConfigWriteTarget("Write", {})).toBeNull();
    expect(dirConfigWriteTarget("Write", { file_path: 42 })).toBeNull();
    expect(dirConfigWriteTarget(undefined, { file_path: file })).toBeNull();
  });
});

describe("publicDirConfig / dirSoundFor", () => {
  it("exposes hasSound but not the raw path", () => {
    const { dir, cleanup } = withConfig({ name: "x", sound: "./a.mp3", fontSize: 20, fontFamily: "Cica", orderPriority: -3 });
    writeFileSync(path.join(dir, "a.mp3"), "x");
    expect(publicDirConfig(dir)).toEqual({
      name: "x",
      badgeColor: null,
      headerColor: null,
      headerTextColor: null,
      cellColor: null,
      cellBorderColor: null,
      dotColor: null,
      buttonColor: null,
      // On the wire on purpose: the browser needs it to size the terminal, and unlike `sound`
      // there is nothing sensitive about it.
      fontSize: 20,
      // normalized on load: the missing generic tail is appended, so a stack whose fonts are
      // all absent still lands on a monospace face rather than the browser's proportional default.
      fontFamily: "Cica, monospace",
      // Negative on purpose: a rank is an ordering, not a size, so "before everything at 0"
      // has to survive the wire rather than be normalised away.
      orderPriority: -3,
      theme: null,
      colors: null,
      hasSound: true,
    });
    expect(dirSoundFor(dir, null)).toEqual({ source: "file", path: path.join(dir, "a.mp3") });
    cleanup();
  });

  it("reports hasSound false when the sound is missing", () => {
    const { dir, cleanup } = withConfig({ sound: "./gone.mp3" });
    expect(publicDirConfig(dir).hasSound).toBe(false);
    expect(dirSoundFor(dir, null)).toBeNull();
    cleanup();
  });
});

describe("per-kind directory sounds", () => {
  it("overrides the all-kind sound for the kind it names", () => {
    const { dir, cleanup } = withConfig({ sound: "./all.mp3", sounds: { waiting: "./ask.mp3" } });
    writeFileSync(path.join(dir, "all.mp3"), "x");
    writeFileSync(path.join(dir, "ask.mp3"), "x");
    expect(dirSoundFor(dir, "waiting")).toEqual({ source: "file", path: path.join(dir, "ask.mp3") });
    // A kind with no entry of its own still gets the directory's all-kind sound.
    expect(dirSoundFor(dir, "finished")).toEqual({ source: "file", path: path.join(dir, "all.mp3") });
    cleanup();
  });

  it("accepts a preset, so a project needs no audio file of its own", () => {
    const { dir, cleanup } = withConfig({ sounds: { "command-failed": "preset:gong" } });
    expect(dirSoundFor(dir, "command-failed")).toEqual({ source: "preset", id: "gong" });
    expect(dirSoundFor(dir, "finished")).toBeNull();
    cleanup();
  });

  // The confinement that makes `sound` safe has to hold for every entry here too — otherwise
  // opening someone's project would let it read any file on the machine.
  it("confines a per-kind file to the directory", () => {
    const { dir, cleanup } = withConfig({ sounds: { finished: "../escape.mp3", waiting: "/etc/passwd", "command-done": "preset:nope" } });
    writeFileSync(path.join(dir, "..", "escape.mp3"), "x");
    expect(loadDirConfig(dir).sounds).toEqual({});
    rmSync(path.join(dir, "..", "escape.mp3"), { force: true });
    cleanup();
  });

  it("counts a per-kind sound towards hasSound", () => {
    const { dir, cleanup } = withConfig({ sounds: { waiting: "preset:coin" } });
    expect(publicDirConfig(dir).hasSound).toBe(true);
    cleanup();
  });
});

// The settings modal's preview. Its job is to tell "never set" apart from "set and dropped",
// which is exactly what the resolved config alone cannot say.
describe("dirConfigDetail", () => {
  it("reports no file for a directory that has none", () => {
    const dir = tmp();
    const detail = dirConfigDetail(dir);
    expect(detail.file).toBeNull();
    expect(detail.source).toEqual({ applied: [], ignored: [], unknown: [] });
    rmSync(dir, { recursive: true, force: true });
  });

  it("separates what applied, what was dropped, and what is not a setting at all", () => {
    const { dir, cleanup } = withConfig({ name: "proj", headerColor: "#2b3a55", cellColor: "rebeccapurple", badgeColour: "#123456" });
    const detail = dirConfigDetail(dir);
    expect(detail.file).toBe(path.join(dir, ".mulmoterminal.json"));
    expect(detail.source.applied.sort()).toEqual(["headerColor", "name"]);
    expect(detail.source.ignored).toEqual(["cellColor"]); // a CSS colour name is not #rrggbb
    expect(detail.source.unknown).toEqual(["badgeColour"]);
    expect(detail.config.headerColor).toBe("#2b3a55");
    cleanup();
  });

  it("says a malformed file set nothing, rather than failing", () => {
    const { dir, cleanup } = withConfig("{ not json");
    const detail = dirConfigDetail(dir);
    expect(detail.file).toBe(path.join(dir, ".mulmoterminal.json"));
    expect(detail.source).toEqual({ applied: [], ignored: [], unknown: [] });
    cleanup();
  });

  it("carries the settings PublicDirConfig leaves out, so the preview can show them", () => {
    const { dir, cleanup } = withConfig({
      provider: "openrouter",
      model: "moonshotai/kimi-k2",
      skills: ["deploy"],
      buttons: [{ id: "b1", label: "Deploy", run: "shell", cmd: "make deploy" }],
      chips: ["git", { label: "Build", text: "yarn build" }],
      appendSystemPrompt: false,
    });
    const { extras } = dirConfigDetail(dir);
    expect(extras.provider).toBe("openrouter");
    expect(extras.model).toBe("moonshotai/kimi-k2");
    expect(extras.skills).toEqual(["deploy"]);
    expect(extras.buttonLabels).toEqual(["Deploy"]);
    expect(extras.chipLabels).toEqual(["git", "Build"]);
    // #1062. `false` is a setting, and the preview builds its rows from `extras` — dropped here,
    // a file whose only key is this one reports as setting nothing at all.
    expect(extras.appendSystemPrompt).toBe(false);
    cleanup();
  });

  // What the button would TYPE into the session is not part of "did my config take effect",
  // and a settings screenshot should not carry it.
  it("names a header button without its command", () => {
    const { dir, cleanup } = withConfig({ buttons: [{ id: "b1", label: "Deploy", run: "shell", cmd: "make deploy --token=hunter2" }] });
    expect(JSON.stringify(dirConfigDetail(dir).extras)).not.toContain("hunter2");
    cleanup();
  });

  // The preview labels the file's path as where every value under it came from, which only
  // holds because this resolves that ONE file — no global config and no defaults are merged
  // in. A directory with no file must therefore report nothing, not the app-wide settings.
  it("reads this directory's file alone, with nothing merged in", () => {
    const dir = tmp();
    const { config, extras } = dirConfigDetail(dir);
    expect(Object.values(config).every((value) => value === null || value === false)).toBe(true);
    expect(extras).toEqual({ provider: null, model: null, skills: null, addDirs: null, appendSystemPrompt: null, buttonLabels: [], chipLabels: [] });
    rmSync(dir, { recursive: true, force: true });
  });

  // Codex on #952: the route used to resolve `?cwd=` with the fallback-to-CLAUDE_CWD helper, so
  // a preset pointing at a deleted project answered with a DIFFERENT directory's settings under
  // the requested path's name. The route now refuses to fall back; this pins the payload it
  // sends instead.
  it("reports a directory that is gone as gone, not as one with no config", () => {
    expect(MISSING_DIR_CONFIG_DETAIL.exists).toBe(false);
    expect(MISSING_DIR_CONFIG_DETAIL.file).toBeNull();
    expect(MISSING_DIR_CONFIG_DETAIL.source).toEqual({ applied: [], ignored: [], unknown: [] });
    expect(Object.values(MISSING_DIR_CONFIG_DETAIL.config).every((v) => v === null || v === false)).toBe(true);
  });

  it("marks a real directory as existing, whether or not it has a file", () => {
    const dir = tmp();
    expect(dirConfigDetail(dir).exists).toBe(true);
    rmSync(dir, { recursive: true, force: true });
    const { dir: configured, cleanup } = withConfig({ name: "proj" });
    expect(dirConfigDetail(configured).exists).toBe(true);
    cleanup();
  });

  // The key list the preview labels things with lives in common/ and the loader lives here;
  // nothing but this test stops a field added to one from going missing in the other.
  it("documents every key the loader reads", () => {
    const { dir, cleanup } = withConfig({});
    expect([...DIR_CONFIG_KEYS].sort()).toEqual(Object.keys(loadDirConfig(dir)).sort());
    cleanup();
  });
});
