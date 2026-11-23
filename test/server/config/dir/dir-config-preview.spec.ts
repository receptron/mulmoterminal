// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dirConfigDetail } from "../../../../server/config/dir/dir-config";
import { DIR_CONFIG_KEYS } from "../../../../common/dirConfigSource";
import { dirConfigRows } from "../../../../src/components/dirConfigDetail";

// The preview's rows are built on the CLIENT from what the server sends, so neither side alone
// can tell whether a setting is visible. #1062 fell through exactly there: the loader read
// `appendSystemPrompt`, `describeDirConfig` called it applied, and the panel still rendered "The
// file sets nothing this app applies." — on the screen someone opens BECAUSE a setting looks like
// it isn't working. The two ends are walked together here, one key at a time.
//
// A fixture per key rather than one big config: a row that appears only because a NEIGHBOURING
// key produced it is the failure this is meant to catch.
const FIXTURES: Record<string, unknown> = {
  name: "proj",
  icon: "./logo.png", // written to disk below — resolveDirIcon drops a path that isn't there
  backgroundImage: { image: "./logo.png", opacity: 0.2 }, // the same file, held to the icon's rules
  badgeColor: "#112233",
  headerColor: "#112233",
  headerTextColor: "#112233",
  headerStatusColors: { working: "#112233" },
  headerStatusTint: "none",
  cellColor: "#112233",
  cellBorderColor: "#112233",
  dotColor: "#112233",
  buttonColor: "#112233",
  fontSize: 14,
  fontFamily: "'Cica', monospace",
  orderPriority: 5,
  theme: "nord",
  colors: { background: "#000000" },
  sound: "./alert.mp3", // written to disk below — resolveDirSound drops a path that isn't there
  sounds: { waiting: "preset:coin" },
  buttons: [{ id: "b1", label: "Deploy", run: "shell", cmd: "make deploy" }],
  chips: ["git"],
  commands: [{ id: "c1", label: "Release", run: "shell", cmd: "make release" }],
  skills: ["review"],
  decks: ["decks/talk.json"],
  mobileFiles: { dirs: ["sibling"], extensions: ["md"] },
  provider: "openrouter",
  model: "opus",
  addDirs: ["./sibling"], // created below — a path that doesn't exist is dropped by the loader
  appendSystemPrompt: false,
  worktreeEnv: { PORT: { kind: "port", base: 3000 } },
  review: { reviewer: "codex" },
};

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function dirSetting(key: string, value: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-preview-"));
  dirs.push(dir);
  writeFileSync(path.join(dir, "alert.mp3"), "x");
  writeFileSync(path.join(dir, "logo.png"), "x");
  mkdirSync(path.join(dir, "sibling"));
  writeFileSync(path.join(dir, ".mulmoterminal.json"), JSON.stringify({ [key]: value }));
  return dir;
}

describe("every directory setting reaches the preview", () => {
  // Failing here for a NEW key is the point: it means the loader honours something the panel
  // will not show, so add a fixture and then whatever surfaces it.
  it("has a fixture for every key the loader reads", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...DIR_CONFIG_KEYS].sort());
  });

  // Not "a row whose key matches": `sounds` is surfaced by the `sound` row, and what matters to
  // the reader is that the panel says SOMETHING rather than claiming the file set nothing.
  it.each(DIR_CONFIG_KEYS.map((key) => [key] as const))("shows a row for a file that sets only %s", (key) => {
    const detail = dirConfigDetail(dirSetting(key, FIXTURES[key]));
    expect(detail.source.applied).toContain(key);
    expect(dirConfigRows(detail.config, detail.extras).length).toBeGreaterThan(0);
  });
});

// The Settings form (#2722) edits what THIS directory's files say, so its values must come from the
// two files and nothing under them — and only for the keys it edits.
describe("dirConfigDetail formValues", () => {
  const made: string[] = [];
  afterEach(() => made.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it("merges the shared and local files, and leaves out repo.json and keys the app does not read", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-formvalues-"));
    made.push(dir);
    writeFileSync(path.join(dir, "repo.json"), JSON.stringify({ name: "from-repo", color: "#abcdef" }));
    writeFileSync(path.join(dir, ".mulmoterminal.json"), JSON.stringify({ fontSize: 14, headerColor: "#111111", colour: "#333333", fontFamily: 7 }));
    writeFileSync(path.join(dir, ".mulmoterminal.local.json"), JSON.stringify({ headerColor: "#222222" }));
    expect(dirConfigDetail(dir).formValues).toEqual({ headerColor: "#222222", fontSize: 14, fontFamily: 7 });
  });

  it("is empty for a directory with no files", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mt-formvalues-"));
    made.push(dir);
    expect(dirConfigDetail(dir).formValues).toEqual({});
  });
});
