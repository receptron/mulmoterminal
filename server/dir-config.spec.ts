import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveDirSound, loadDirConfig, publicDirConfig, dirSoundFile, dirConfigWriteTarget } from "./dir-config";

const tmp = () => mkdtempSync(path.join(tmpdir(), "mt-dircfg-"));
const EMPTY = {
  name: null,
  badgeColor: null,
  headerColor: null,
  headerTextColor: null,
  cellColor: null,
  cellBorderColor: null,
  dotColor: null,
  buttonColor: null,
  theme: null,
  colors: null,
  sound: null,
  buttons: [],
  chips: null,
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
      theme: "nord",
      sound: "./a.mp3",
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
      theme: "nord",
      colors: null,
      sound: path.join(dir, "a.mp3"),
      buttons: [],
      chips: null,
    });
    cleanup();
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

  it("drops an unknown theme and a malformed color", () => {
    const { dir, cleanup } = withConfig({ theme: "neon", badgeColor: "red" });
    expect(loadDirConfig(dir)).toEqual(EMPTY);
    cleanup();
  });

  it("returns all-null for a missing file", () => {
    const dir = tmp();
    expect(loadDirConfig(dir)).toEqual(EMPTY);
    rmSync(dir, { recursive: true, force: true });
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
  const file = "/Users/me/proj/.mulmoterminal.json";

  it("returns the directory for each file-writing tool", () => {
    for (const tool of ["Write", "Edit", "MultiEdit"]) {
      expect(dirConfigWriteTarget(tool, { file_path: file })).toBe("/Users/me/proj");
    }
  });

  it("resolves a relative path to an absolute directory", () => {
    expect(dirConfigWriteTarget("Write", { file_path: ".mulmoterminal.json" })).toBe(path.resolve("."));
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

describe("publicDirConfig / dirSoundFile", () => {
  it("exposes hasSound but not the raw path", () => {
    const { dir, cleanup } = withConfig({ name: "x", sound: "./a.mp3" });
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
      theme: null,
      colors: null,
      hasSound: true,
    });
    expect(dirSoundFile(dir)).toBe(path.join(dir, "a.mp3"));
    cleanup();
  });

  it("reports hasSound false when the sound is missing", () => {
    const { dir, cleanup } = withConfig({ sound: "./gone.mp3" });
    expect(publicDirConfig(dir).hasSound).toBe(false);
    expect(dirSoundFile(dir)).toBeNull();
    cleanup();
  });
});
