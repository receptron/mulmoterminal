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
  providers: { ui: true, skill: "mulmoterminal-model" },
  soundFile: { ui: true, skill: "mulmoterminal-notify" },
  soundKinds: { ui: true, skill: "mulmoterminal-notify" },
  sounds: { ui: true, skill: "mulmoterminal-notify" },
  prRepos: { ui: true, skill: CONFIG_SKILL },
  gitlabHosts: { ui: true, skill: CONFIG_SKILL },
  repoDirs: { ui: true },
  launchers: { ui: true },
  customAgents: { ui: true, skill: "mulmoterminal-model" },
  // Beside customAgents in the same skill: both change how a cell's CLI is started (#2215).
  accounts: { ui: true, skill: "mulmoterminal-model" },
  // Config.json only for now; the skill is how it is set (#2919).
  tokenRotation: { skill: "mulmoterminal-model" },
  // Half of it is a start-up decision (it gates whether the app runs without Claude Code at all), so
  // the control offers an agent this machine cannot start only disabled — saving one would stop the
  // next launch.
  defaultAgent: { ui: true, skill: "mulmoterminal-model" },
  quickCommands: { ui: true },
  userMcpServers: { ui: true },
  themes: { ui: true, skill: "mulmoterminal-theme" },
  buttons: { ui: true, skill: "mulmoterminal-header" },
  chips: { ui: true, skill: "mulmoterminal-header" },
  commands: { skill: "mulmoterminal-header" },
  pushEnabled: { ui: true, skill: "mulmoterminal-notify" },
  pushKinds: { ui: true, skill: "mulmoterminal-notify" },
  worklogEnabled: { ui: true, skill: CONFIG_SKILL },
  worklogIntervalHours: { ui: true, skill: CONFIG_SKILL },
  feedRefreshEnabled: { ui: true, skill: CONFIG_SKILL },
  calendarSyncEnabled: { ui: true, skill: CONFIG_SKILL },
  sessionIdleReapDays: { ui: true, skill: CONFIG_SKILL },
  // Beside the threshold it repeats, which is the list both numbers act on (#2177). It started
  // config-file only, and a default of 0 meant the feature did not exist for anyone who had not
  // opened config.json — the argument for a control rather than against one.
  sessionReapIntervalHours: { ui: true, skill: CONFIG_SKILL },
  terminalSubmit: { ui: true, skill: "mulmoterminal-keys" },
  keymap: { ui: true, skill: "mulmoterminal-keys" },
  // Beside keymap: both decide what reaches an action, and neither has a control (#2540).
  paletteAliases: { skill: "mulmoterminal-keys" },
  // No Settings control: the palette's own panel adds one at a time (#2546), through its own route.
  paletteFavorites: { skill: "mulmoterminal-keys" },
  copyOnSelect: { ui: true, skill: "mulmoterminal-keys" },
  tmuxPrefix: { ui: true, skill: "mulmoterminal-keys" },
  questionPaneEnabled: { ui: true, skill: "mulmoterminal-keys" },
  decisionDigest: { ui: true, skill: CONFIG_SKILL },
  issueWorkComments: { ui: true, skill: CONFIG_SKILL },
  prWorkdirFooter: { ui: true, skill: CONFIG_SKILL },
  appendSystemPrompt: { ui: true, skill: CONFIG_SKILL },
  autoDirIcon: { ui: true, skill: "mulmoterminal-dirs" },
  // Same owner as the other seven chrome colours, and for the same reason: it is one setting with
  // one shape, written to the global file as a DEFAULT and to a directory's file as an override.
  // Splitting the two halves across two skills would give one setting two owners.
  headerStatusColors: { ui: true, skill: "mulmoterminal-dirs" },
  headerStatusTint: { ui: true, skill: "mulmoterminal-dirs" },
  cockpitLines: { ui: true, skill: CONFIG_SKILL },
  showLoadAverage: { ui: true, skill: CONFIG_SKILL },
  // Beside the load average in Settings → Grid header read-outs (#2569).
  paletteSearchBox: { ui: true, skill: CONFIG_SKILL },
  // Experimental (#2669): a box under Sessions and background tasks; the config skill documents it.
  remoteServer: { ui: true, skill: CONFIG_SKILL },
  toolbarPins: { ui: true, skill: CONFIG_SKILL },
  // On/off only in Settings, worded so it does not advertise: which pictures exist is left to find.
  playfulEffects: { ui: true, skill: CONFIG_SKILL },
  confetti: { ui: true, skill: CONFIG_SKILL },
  fontFamily: { ui: true, skill: "mulmoterminal-dirs" },
};

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
// Four forms, named rather than pattern-guessed. A fifth way to write config should have to be
// added here — there is no reason for there to be many. The fourth is a list changed one entry at a
// time on the server (#2620), so a tab never sends a copy that drops what it had not seen.
const ONE_ENTRY_ROUTES: Partial<Record<string, string>> = {
  customAgents: "/api/config/custom-agents/",
  accounts: "/api/config/accounts/",
  providers: "/api/config/providers/",
  keymap: "/api/config/keymap/binding",
  chips: "/api/config/chips/",
  buttons: "/api/config/buttons/",
  themes: "/api/config/themes/",
};
const writesKey = (source: string, key: string): boolean => {
  const route = ONE_ENTRY_ROUTES[key];
  return (
    source.includes(`postConfigField("${key}"`) ||
    source.includes(`createGlobalFlag("${key}"`) ||
    source.includes(`JSON.stringify({ ${key}:`) ||
    (route !== undefined && source.includes(route))
  );
};

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
});
