// @vitest-environment node
import { describe, it, expect } from "vitest";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { makeTempDir } from "../../../support/tempDir.js";
import { loadDirConfig } from "../../../../server/config/dir/dir-config";
import { inheritedWorktreeConfig, writeInheritedDirConfig } from "../../../../server/config/worktree/worktree-dir-config";
import { DIR_CONFIG_KEYS } from "../../../../common/dirConfigSource";

const CONFIG_FILE = ".mulmoterminal.json";
// What the inherited config is WRITTEN to: the local override (#1436), which is gitignored, so a
// worktree carrying it still reads as clean and can be removed without force.
const LOCAL_CONFIG_FILE = ".mulmoterminal.local.json";

// Written and read back through loadDirConfig rather than hand-built, so these tests exercise
// the same validation the server does — a field the loader would drop can't pass here.
function projectDir(config: Record<string, unknown> | null): string {
  const dir = makeTempDir("mt-wtcfg-");
  if (config) writeFileSync(path.join(dir, CONFIG_FILE), JSON.stringify(config), "utf8");
  return dir;
}

const inheritedFrom = (config: Record<string, unknown> | null, index: number) => inheritedWorktreeConfig(loadDirConfig(projectDir(config)), index);

const PROJECT = {
  name: "mulmoterminal",
  theme: "midnight",
  colors: { background: "#101020" },
  fontSize: 13,
  fontFamily: "Menlo, monospace",
  provider: "ollama",
  model: "qwen3:8b",
  badgeColor: "#1b3479",
  headerColor: "#2d4ea9",
  headerTextColor: "#ffffff",
  cellColor: "#f2f4fb",
  cellBorderColor: "#5175d6",
  dotColor: "#5175d6",
  buttonColor: "#cfdaf7",
  orderPriority: 30,
};

// Every key `loadDirConfig` reads is inherited, tinted, or deliberately left behind — and the
// third case has to be SAID. Nothing failed when `headerStatusColors` was added to the loader and
// not here (#1617): the project's cell had the colour, its worktrees quietly did not, and only
// someone opening a worktree beside its parent would see it. The list below is what makes leaving
// a key out a decision instead of an omission.
// `decks` sits with `skills` / `buttons` / `chips`: a header MENU's contents, which a worktree
// composes for itself. It still gets the workspace's own stories directory, so the menu is not empty.
const DELIBERATELY_NOT_INHERITED = ["sound", "sounds", "addDirs", "buttons", "commands", "chips", "skills", "decks", "mobileFiles", "appendSystemPrompt"];

describe("every directory setting is inherited or deliberately not", () => {
  it("accounts for every key the loader reads", () => {
    // A project that sets EVERY key, so a key missing from the result is missing by rule rather
    // than because this fixture didn't set it.
    const everything = {
      ...PROJECT,
      icon: "https://example.com/logo.png",
      backgroundImage: "https://example.com/bg.png",
      worktreeEnv: { PORT: { kind: "port", base: 3000 } },
      headerStatusColors: { working: "#6d28d9" },
      headerStatusTint: "none",
      sound: "./a.mp3", // dropped by the loader (no such file) — it is in the "not inherited" list anyway
      addDirs: ["."],
      buttons: [{ id: "pr", label: "PR", run: "shell", cmd: "gh pr create" }],
      chips: ["git"],
      skills: ["review"],
      appendSystemPrompt: false,
      review: { reviewer: "claude" },
    };
    const inherited = Object.keys(inheritedFrom(everything, 1));
    const unaccounted = [...DIR_CONFIG_KEYS].filter((key) => !inherited.includes(key) && !DELIBERATELY_NOT_INHERITED.includes(key));
    expect(unaccounted).toEqual([]);
  });
});

describe("inheritedWorktreeConfig", () => {
  it("carries the project's identity over unchanged", () => {
    expect(inheritedFrom(PROJECT, 1)).toMatchObject({
      name: "mulmoterminal",
      theme: "midnight",
      colors: { background: "#101020" },
      fontSize: 13,
      fontFamily: "Menlo, monospace",
      provider: "ollama",
      model: "qwen3:8b",
    });
  });

  // The header a glance lands on is the same header in a worktree, so a project that recoloured
  // its running state keeps that colour — moved by the same step as the rest of the chrome, or
  // `working` would be the one part of the cell still reading as the parent's.
  it("tints the per-status header colours too, and carries the tint MODE unchanged", () => {
    const project = { ...PROJECT, headerStatusColors: { working: "#2d4ea9", blocked: { background: "#7c2d12", text: "#ffe8a3" } }, headerStatusTint: "none" };
    const first = inheritedFrom(project, 1);
    expect(first.headerStatusColors).toEqual({
      working: { background: first.headerColor }, // the same colour as the header, so the same rotation
      // #7c2d12 sits at hue 15.3 degrees; a step of 12 puts it at 27.3 with saturation and
      // lightness untouched, which is #7c4212. The ink moves with it.
      blocked: { background: "#7c4212", text: "#fffaa3" },
    });
    // A mode has no hue to rotate.
    expect(first.headerStatusTint).toBe("none");
    // And it steps further out with each worktree, like every other chrome colour.
    expect(inheritedFrom(project, 2).headerStatusColors).not.toEqual(first.headerStatusColors);
  });

  it("writes no status block for a project that configured none", () => {
    expect(inheritedFrom(PROJECT, 1)).not.toHaveProperty("headerStatusColors");
    expect(inheritedFrom(PROJECT, 1)).not.toHaveProperty("headerStatusTint");
  });

  it("tints the chrome colours, a step further for each worktree", () => {
    const first = inheritedFrom(PROJECT, 1);
    const second = inheritedFrom(PROJECT, 2);
    expect(first.headerColor).toBe("#2d35a9");
    expect(second.headerColor).toBe("#3e2da9");
    expect(first.badgeColor).not.toBe(PROJECT.badgeColor);
    expect(second.badgeColor).not.toBe(first.badgeColor);
    // The terminal's own palette is identity, not chrome: rotating it would move the ANSI
    // colours a program's output names.
    expect(second.colors).toEqual(PROJECT.colors);
  });

  it("leaves a grey chrome colour exactly as the project wrote it", () => {
    expect(inheritedFrom(PROJECT, 3).headerTextColor).toBe("#ffffff");
  });

  // The worktree sorts directly after the project it was cut from, instead of falling to the
  // end of the grid as an unranked directory does.
  it("ranks the worktree one past its parent", () => {
    expect(inheritedFrom(PROJECT, 1).orderPriority).toBe(31);
    expect(inheritedFrom(PROJECT, 2).orderPriority).toBe(31);
  });

  it("invents no rank for a project that declares none", () => {
    expect(inheritedFrom({ headerColor: "#2d4ea9" }, 1)).not.toHaveProperty("orderPriority");
  });

  // Copied verbatim these would misfire: the sound file lives in the parent directory, and
  // addDirs entries resolve against whichever directory the config sits in.
  it("carries neither the sounds nor the extra directories", () => {
    const dir = projectDir({ sound: "ding.mp3", sounds: { done: "preset:chime" }, addDirs: ["."], headerColor: "#2d4ea9" });
    writeFileSync(path.join(dir, "ding.mp3"), "x", "utf8");
    const inherited = inheritedWorktreeConfig(loadDirConfig(dir), 1);
    expect(inherited).not.toHaveProperty("sound");
    expect(inherited).not.toHaveProperty("sounds");
    expect(inherited).not.toHaveProperty("addDirs");
    expect(inherited.headerColor).toBe("#2d35a9");
  });

  // Unlike the sound, an icon IS carried — but as the relative path the user typed, not as the
  // absolute one the loader resolved. An absolute path would be refused by the very rule that
  // produced it, so a worktree of a repo whose logo is committed would silently lose its icon.
  it("carries a file icon as the relative path, so it resolves again in the worktree", () => {
    const dir = projectDir({ icon: "docs/logo.png" });
    mkdirSync(path.join(dir, "docs"));
    writeFileSync(path.join(dir, "docs", "logo.png"), "x", "utf8");
    const inherited = inheritedWorktreeConfig(loadDirConfig(dir), 1);
    expect(inherited.icon).toBe("docs/logo.png");
    expect(inherited.icon).not.toContain(dir);
  });

  it("carries a file background as the path as typed, with its opacity and fit", () => {
    const dir = projectDir({ backgroundImage: { image: "docs/logo.png", opacity: 0.3 } });
    mkdirSync(path.join(dir, "docs"));
    writeFileSync(path.join(dir, "docs", "logo.png"), "x", "utf8");
    const inherited = inheritedWorktreeConfig(loadDirConfig(dir), 1);
    expect(inherited.backgroundImage).toEqual({ image: "docs/logo.png", opacity: 0.3, fit: "cover" });
  });

  it("carries a remote icon verbatim", () => {
    expect(inheritedFrom({ icon: "https://example.com/logo.png" }, 1).icon).toBe("https://example.com/logo.png");
  });

  it("has nothing to say about a project that configures nothing", () => {
    expect(inheritedFrom(null, 1)).toEqual({});
    expect(inheritedFrom({ sound: "gone.mp3" }, 1)).toEqual({});
  });

  // Number.MAX_SAFE_INTEGER + 1 is not distinct from its neighbour, so it cannot express a rank
  // — and the loader on the other side would read it back as unset.
  it("drops a rank that cannot be stepped past", () => {
    expect(inheritedFrom({ orderPriority: Number.MAX_SAFE_INTEGER }, 1)).not.toHaveProperty("orderPriority");
  });
});

describe("writeInheritedDirConfig", () => {
  it("writes a config the loader reads back", () => {
    const worktree = makeTempDir("mt-wt-");
    expect(writeInheritedDirConfig(projectDir(PROJECT), worktree, 1)).toBe(true);
    const loaded = loadDirConfig(worktree);
    expect(loaded.name).toBe("mulmoterminal");
    expect(loaded.headerColor).toBe("#2d35a9");
    expect(loaded.orderPriority).toBe(31);
    expect(loaded.model).toBe("qwen3:8b");
  });

  // The status block is the one inherited value whose written SHAPE differs from the parent's:
  // the deriver emits `{ background }` with no `text`, where the parent may have written a bare
  // hex string. Nothing above reads that back through the loader — `PROJECT` sets no status
  // colours — so "the loader accepts what the deriver writes" was an assumption, not a tested
  // fact. (Observed during Claude review; not flagged by Codex.)
  it("writes per-status colours the loader reads back", () => {
    const worktree = makeTempDir("mt-wt-");
    const project = projectDir({ ...PROJECT, headerStatusColors: { working: "#2d4ea9" }, headerStatusTint: "none" });
    expect(writeInheritedDirConfig(project, worktree, 1)).toBe(true);
    const loaded = loadDirConfig(worktree);
    expect(loaded.headerStatusColors).toEqual({ working: { background: "#2d35a9", text: null } });
    expect(loaded.headerStatusTint).toBe("none");
  });

  it("leaves no file behind when there is nothing to inherit", () => {
    const worktree = makeTempDir("mt-wt-");
    expect(writeInheritedDirConfig(projectDir(null), worktree, 1)).toBe(false);
    expect(existsSync(path.join(worktree, LOCAL_CONFIG_FILE))).toBe(false);
  });

  // A worktree that already has one either committed it or was set up by hand; either way that
  // file is the answer and ours would silently replace it.
  it("never overwrites a local config the worktree already has", () => {
    const worktree = makeTempDir("mt-wt-");
    writeFileSync(path.join(worktree, LOCAL_CONFIG_FILE), '{"name":"mine"}', "utf8");
    expect(writeInheritedDirConfig(projectDir(PROJECT), worktree, 1)).toBe(false);
    expect(readFileSync(path.join(worktree, LOCAL_CONFIG_FILE), "utf8")).toBe('{"name":"mine"}');
  });

  // A worktree of a repository that COMMITS its shared config has that file already, checked out
  // by git. Refusing to write because of it would leave every such worktree untinted — the shared
  // file is what the local one is meant to layer over, not a reason to stand down (#1436).
  it("writes even when the worktree already has a shared config from the checkout", () => {
    const worktree = makeTempDir("mt-wt-");
    writeFileSync(path.join(worktree, CONFIG_FILE), '{"name":"committed"}', "utf8");
    expect(writeInheritedDirConfig(projectDir(PROJECT), worktree, 1)).toBe(true);
    expect(readFileSync(path.join(worktree, CONFIG_FILE), "utf8")).toBe('{"name":"committed"}');
    expect(JSON.parse(readFileSync(path.join(worktree, LOCAL_CONFIG_FILE), "utf8"))).toMatchObject({ name: "mulmoterminal" });
  });
});
