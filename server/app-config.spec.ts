import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sanitizeSoundFile, sanitizeRepos, sanitizeLaunchers, loadAppConfig, saveAppConfig } from "./app-config";

const tmp = () => mkdtempSync(path.join(tmpdir(), "mt-appcfg-"));

describe("sanitizeSoundFile", () => {
  it("keeps a non-empty trimmed ABSOLUTE path, else null", () => {
    expect(sanitizeSoundFile("  /a/b.wav ")).toBe("/a/b.wav");
    expect(sanitizeSoundFile("")).toBeNull();
    expect(sanitizeSoundFile("   ")).toBeNull();
    expect(sanitizeSoundFile(null)).toBeNull();
    expect(sanitizeSoundFile(42)).toBeNull();
  });
  it("rejects relative paths (absolute-only contract)", () => {
    expect(sanitizeSoundFile("sound.wav")).toBeNull();
    expect(sanitizeSoundFile("relative/path.wav")).toBeNull();
    expect(sanitizeSoundFile("./a.wav")).toBeNull();
    expect(sanitizeSoundFile("../a.wav")).toBeNull();
  });
});

describe("sanitizeRepos", () => {
  it("keeps trimmed owner/repo slugs, drops junk, de-dupes", () => {
    expect(sanitizeRepos(["  a/b ", "c/d", "a/b", "no-slash", "x/y/z", 5, "bad name/repo"])).toEqual(["a/b", "c/d"]);
    expect(sanitizeRepos("nope")).toEqual([]);
    expect(sanitizeRepos(undefined)).toEqual([]);
  });
});

describe("sanitizeLaunchers", () => {
  it("keeps trimmed label+command pairs, drops incomplete/dup, caps count", () => {
    expect(
      sanitizeLaunchers([
        { label: "  Shell ", command: " $SHELL " },
        { label: "Codex", command: "codex" },
        { label: "Shell", command: "zsh" }, // dup label — dropped
        { label: "NoCmd", command: "" }, // no command — dropped
        { label: "", command: "x" }, // no label — dropped
        "junk",
      ]),
    ).toEqual([
      { label: "Shell", command: "$SHELL" },
      { label: "Codex", command: "codex" },
    ]);
    expect(sanitizeLaunchers("nope")).toEqual([]);
    expect(sanitizeLaunchers(undefined)).toEqual([]);
  });
  it("caps the number of launchers", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ label: `L${i}`, command: `c${i}` }));
    expect(sanitizeLaunchers(many).length).toBeLessThanOrEqual(20);
  });
});

describe("loadAppConfig / saveAppConfig", () => {
  it("round-trips presets + soundFile + prRepos + launchers through a file", () => {
    const dir = tmp();
    const file = path.join(dir, "nested", "config.json"); // nested → mkdir is exercised
    const cfg = { cwdPresets: [{ label: "x", path: "/x" }], soundFile: "/s.wav", prRepos: ["o/r"], launchers: [{ label: "Shell", command: "$SHELL" }] };
    expect(saveAppConfig(file, cfg)).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(cfg);
    expect(loadAppConfig(file)).toEqual(cfg);
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to empty presets + null sound + empty repos/launchers for a missing file", () => {
    const dir = tmp();
    expect(loadAppConfig(path.join(dir, "none.json"))).toEqual({ cwdPresets: [], soundFile: null, prRepos: [], launchers: [] });
    rmSync(dir, { recursive: true, force: true });
  });

  it("sanitizes junk presets, a non-string sound, bad repos, and bad launchers on load", () => {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        cwdPresets: [{ label: "a", path: "/a" }, "junk"],
        soundFile: 5,
        prRepos: ["o/r", "bad"],
        launchers: [{ label: "S", command: "sh" }, "x"],
      }),
    );
    expect(loadAppConfig(file)).toEqual({
      cwdPresets: [{ label: "a", path: "/a" }],
      soundFile: null,
      prRepos: ["o/r"],
      launchers: [{ label: "S", command: "sh" }],
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns defaults for invalid JSON", () => {
    const dir = tmp();
    const file = path.join(dir, "bad.json");
    writeFileSync(file, "{ not json");
    expect(loadAppConfig(file)).toEqual({ cwdPresets: [], soundFile: null, prRepos: [], launchers: [] });
    rmSync(dir, { recursive: true, force: true });
  });

  it("preserves the legacy presets-only shape (soundFile / prRepos / launchers absent => defaults)", () => {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ cwdPresets: [{ label: "a", path: "/a" }] }));
    expect(loadAppConfig(file)).toEqual({ cwdPresets: [{ label: "a", path: "/a" }], soundFile: null, prRepos: [], launchers: [] });
    rmSync(dir, { recursive: true, force: true });
  });
});
