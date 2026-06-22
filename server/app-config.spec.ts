import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sanitizeSoundFile, loadAppConfig, saveAppConfig } from "./app-config";

const tmp = () => mkdtempSync(path.join(tmpdir(), "mt-appcfg-"));

describe("sanitizeSoundFile", () => {
  it("keeps a non-empty trimmed string, else null", () => {
    expect(sanitizeSoundFile("  /a/b.wav ")).toBe("/a/b.wav");
    expect(sanitizeSoundFile("")).toBeNull();
    expect(sanitizeSoundFile("   ")).toBeNull();
    expect(sanitizeSoundFile(null)).toBeNull();
    expect(sanitizeSoundFile(42)).toBeNull();
  });
});

describe("loadAppConfig / saveAppConfig", () => {
  it("round-trips presets + soundFile through a file", () => {
    const dir = tmp();
    const file = path.join(dir, "nested", "config.json"); // nested → mkdir is exercised
    expect(saveAppConfig(file, { cwdPresets: [{ label: "x", path: "/x" }], soundFile: "/s.wav" })).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ cwdPresets: [{ label: "x", path: "/x" }], soundFile: "/s.wav" });
    expect(loadAppConfig(file)).toEqual({ cwdPresets: [{ label: "x", path: "/x" }], soundFile: "/s.wav" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to empty presets + null sound for a missing file", () => {
    const dir = tmp();
    expect(loadAppConfig(path.join(dir, "none.json"))).toEqual({ cwdPresets: [], soundFile: null });
    rmSync(dir, { recursive: true, force: true });
  });

  it("sanitizes junk presets and a non-string sound on load", () => {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ cwdPresets: [{ label: "a", path: "/a" }, "junk"], soundFile: 5 }));
    expect(loadAppConfig(file)).toEqual({ cwdPresets: [{ label: "a", path: "/a" }], soundFile: null });
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns defaults for invalid JSON", () => {
    const dir = tmp();
    const file = path.join(dir, "bad.json");
    writeFileSync(file, "{ not json");
    expect(loadAppConfig(file)).toEqual({ cwdPresets: [], soundFile: null });
    rmSync(dir, { recursive: true, force: true });
  });

  it("preserves the legacy presets-only shape (soundFile absent => null)", () => {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ cwdPresets: [{ label: "a", path: "/a" }] }));
    expect(loadAppConfig(file)).toEqual({ cwdPresets: [{ label: "a", path: "/a" }], soundFile: null });
    rmSync(dir, { recursive: true, force: true });
  });
});
