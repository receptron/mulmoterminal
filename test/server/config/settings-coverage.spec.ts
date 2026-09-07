// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emptyConfig, toPublicAppConfig } from "../../../server/config/app-config";

// Where a user can actually SET each global setting (#1401).
//
// The inventory that produced this found nine keys no skill documented and twelve with no control
// anywhere, so the only way to reach them was to read the guide and hand-edit JSON. Nothing failed
// while that was true: the key round-tripped through /api/config, the server acted on it, and the
// specs, typecheck and CI were all green. The gap was visible only by reading three trees at once.
//
// So this asserts the thing that has no other home: that every key the config exposes is REACHABLE.
// The map is deliberately hand-written — adding a field to AppConfig fails the first test until its
// author says where users set it, which is the moment to decide rather than the release after.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SETTINGS_DIR = path.join(REPO_ROOT, "src", "components", "settings");
const SKILLS_DIR = path.join(REPO_ROOT, "server", "skills");

// Where each key can be set. `ui` means a control in the Settings modal writes it; `skill` NAMES
// the one bundled skill that documents how to write it. A key needs at least one of the two.
//
// The skill is named rather than flagged so the check can look in THAT file. A plain search across
// `server/skills` passed on any mention anywhere — including this router's own table of contents,
// which is exactly the drift CLAUDE.md's "a setting belongs to exactly one skill" is about
// (CodeRabbit on #1412).
type Reachable = { ui?: true; skill?: string };

const CONFIG_SKILL = "mulmoterminal-config";

const REACHABLE_BY: Record<string, Reachable> = {
  cwdPresets: { ui: true, skill: "mulmoterminal-dirs" },
  providers: { skill: "mulmoterminal-model" },
  soundFile: { ui: true, skill: "mulmoterminal-notify" },
  soundKinds: { ui: true, skill: "mulmoterminal-notify" },
  sounds: { ui: true, skill: "mulmoterminal-notify" },
  prRepos: { ui: true, skill: CONFIG_SKILL },
  gitlabHosts: { ui: true, skill: CONFIG_SKILL },
  repoDirs: { ui: true },
  launchers: { ui: true },
  customAgents: { skill: "mulmoterminal-model" },
  quickCommands: { ui: true },
  userMcpServers: { ui: true },
  themes: { skill: "mulmoterminal-theme" },
  buttons: { skill: "mulmoterminal-header" },
  chips: { skill: "mulmoterminal-header" },
  pushEnabled: { ui: true, skill: "mulmoterminal-notify" },
  pushKinds: { ui: true, skill: "mulmoterminal-notify" },
  worklogEnabled: { ui: true, skill: CONFIG_SKILL },
  worklogIntervalHours: { ui: true, skill: CONFIG_SKILL },
  sessionIdleReapDays: { ui: true, skill: CONFIG_SKILL },
  terminalSubmit: { ui: true, skill: "mulmoterminal-keys" },
  keymap: { skill: "mulmoterminal-keys" },
  copyOnSelect: { ui: true, skill: "mulmoterminal-keys" },
  questionPaneEnabled: { ui: true, skill: "mulmoterminal-keys" },
  decisionDigest: { ui: true, skill: CONFIG_SKILL },
  issueWorkComments: { ui: true, skill: CONFIG_SKILL },
  prWorkdirFooter: { ui: true, skill: CONFIG_SKILL },
  appendSystemPrompt: { ui: true, skill: CONFIG_SKILL },
  autoDirIcon: { ui: true, skill: "mulmoterminal-dirs" },
  // Same owner as the other seven chrome colours, and for the same reason: it is one setting with
  // one shape, written to the global file as a DEFAULT and to a directory's file as an override.
  // Splitting the two halves across two skills would give one setting two owners.
  headerStatusColors: { skill: "mulmoterminal-dirs" },
  headerStatusTint: { skill: "mulmoterminal-dirs" },
  cockpitLines: { ui: true, skill: CONFIG_SKILL },
  showLoadAverage: { ui: true, skill: CONFIG_SKILL },
  toolbarPins: { ui: true, skill: CONFIG_SKILL },
  fontFamily: { ui: true, skill: "mulmoterminal-dirs" },
};

// The settings Settings can only SHOW. Each is structured enough that a form would be a small
// editor with its own wrong-answer failure mode — a binding that steals a key the agent underneath
// needs, a palette, a key in the wrong env var, a command that swallows the arguments it is handed,
// a button whose command does nothing. Each has a section that displays its current state and
// launches the owning skill, which is what the aria-label assertions in SettingsModal.spec pin.
// Listed here so that moving one into the UI is a deliberate edit rather than a quiet lapse.
const DISPLAY_ONLY = ["keymap", "themes", "providers", "customAgents", "buttons", "chips"];

const readAll = (dir: string, ext: string): string => {
  const entries = readdirSync(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(ext))
    .map((entry) => readFileSync(path.join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
};

const uiSources = (): string => readAll(SETTINGS_DIR, ".vue") + readAll(path.join(REPO_ROOT, "src", "composables"), ".ts");
const skillSource = (skill: string): string => readAll(path.join(SKILLS_DIR, skill), ".md");

// Every way the browser writes one config key. Matching the WRITE rather than the key name is what
// makes this test mean something: a key is mentioned in a comment, a type, a label and a guide link
// long before anything can save it, so "the string appears in the UI tree" would have passed
// throughout the gap this exists to close.
//
// Three forms, named rather than pattern-guessed. A fourth way to write config should have to be
// added here — there is no reason for there to be many.
const writesKey = (source: string, key: string): boolean =>
  source.includes(`postConfigField("${key}"`) || source.includes(`createGlobalFlag("${key}"`) || source.includes(`JSON.stringify({ ${key}:`);

describe("every global setting is reachable", () => {
  it("classifies exactly the keys the config exposes", () => {
    const exposed = Object.keys(toPublicAppConfig(emptyConfig())).sort();
    expect(Object.keys(REACHABLE_BY).sort()).toEqual(exposed);
  });

  it("names no key as unreachable", () => {
    const unreachable = Object.entries(REACHABLE_BY)
      .filter(([, where]) => !where.ui && !where.skill)
      .map(([key]) => key);
    expect(unreachable).toEqual([]);
  });

  // Proves the browser can SAVE each one. Which control does it, and that the control is wired to
  // the right field, is what the per-section specs pin.
  it("gives each ui-claimed key a write path", () => {
    const ui = uiSources();
    const missing = Object.entries(REACHABLE_BY)
      .filter(([key, where]) => where.ui && !writesKey(ui, key))
      .map(([key]) => key);
    expect(missing).toEqual([]);
  });

  // A mention is the right bar for the CONTENT — a skill tells the user the key and what it does,
  // and writes the file with its own Write tool rather than through a named helper. What is pinned
  // beyond that is WHERE: the key has to appear in the skill that owns it, so a setting documented
  // only in the router's table of contents fails.
  it("documents each key in the skill that owns it", () => {
    const missing = Object.entries(REACHABLE_BY)
      .filter(([key, where]) => where.skill !== undefined && !skillSource(where.skill).includes(key))
      .map(([key, where]) => `${key} (expected in ${where.skill})`);
    expect(missing).toEqual([]);
  });

  it("keeps the display-only settings out of the UI's write paths", () => {
    const editable = DISPLAY_ONLY.filter((key) => REACHABLE_BY[key]?.ui);
    expect(editable).toEqual([]);
  });
});
