import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dirConfigDetail } from "../../../server/config/dir-config";
import { DIR_CONFIG_KEYS } from "../../../common/dirConfigSource";
import { dirConfigRows } from "../../../src/components/dirConfigDetail";

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
  badgeColor: "#112233",
  headerColor: "#112233",
  headerTextColor: "#112233",
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
  skills: ["review"],
  provider: "openrouter",
  model: "opus",
  addDirs: ["./sibling"], // created below — a path that doesn't exist is dropped by the loader
  appendSystemPrompt: false,
};

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function dirSetting(key: string, value: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mt-preview-"));
  dirs.push(dir);
  writeFileSync(path.join(dir, "alert.mp3"), "x");
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
