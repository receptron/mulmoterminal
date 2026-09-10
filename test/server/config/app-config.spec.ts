// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  sanitizeSoundFile,
  sanitizeRepos,
  sanitizeRepoDirs,
  sanitizeLaunchers,
  sanitizeCustomAgents,
  sanitizeQuickCommands,
  sanitizePushKinds,
  sanitizeUserMcpServers,
  sanitizePushEnabled,
  sanitizePrWorkdirFooter,
  sanitizeFeedRefreshEnabled,
  sanitizeCalendarSyncEnabled,
  sanitizeCopyOnSelect,
  sanitizeTerminalSubmit,
  loadAppConfig,
  loadAppConfigResult,
  backupCorruptConfig,
  emptyConfig,
  saveAppConfig,
  mergeConfigUpdate,
  type AppConfig,
} from "../../../server/config/app-config";
import { DEFAULT_SOUND_KINDS } from "../../../common/notifyKinds.js";
import { DEFAULT_PUSH_KINDS } from "../../../common/pushKinds.js";
import { DEFAULT_COCKPIT_LINES } from "../../../common/cockpitLines.js";
import { DEFAULT_HEADER_STATUS_TINT } from "../../../common/headerStatusColors.js";
import { sanitizeWorklogIntervalHours } from "../../../common/worklogInterval.js";

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

describe("sanitizePushEnabled", () => {
  it("is true only for the boolean true; everything else is false", () => {
    expect(sanitizePushEnabled(true)).toBe(true);
    expect(sanitizePushEnabled(false)).toBe(false);
    expect(sanitizePushEnabled("true")).toBe(false);
    expect(sanitizePushEnabled(1)).toBe(false);
    expect(sanitizePushEnabled(null)).toBe(false);
    expect(sanitizePushEnabled(undefined)).toBe(false);
  });
});

describe("sanitizeCopyOnSelect", () => {
  it("is true only for the boolean true — a highlight must not start copying by accident", () => {
    expect(sanitizeCopyOnSelect(true)).toBe(true);
    expect(sanitizeCopyOnSelect(false)).toBe(false);
    expect(sanitizeCopyOnSelect("true")).toBe(false);
    expect(sanitizeCopyOnSelect(1)).toBe(false);
    expect(sanitizeCopyOnSelect(null)).toBe(false);
    expect(sanitizeCopyOnSelect(undefined)).toBe(false);
  });
});

describe("sanitizePrWorkdirFooter", () => {
  it("is false ONLY for the boolean false — the one default-on switch here", () => {
    expect(sanitizePrWorkdirFooter(false)).toBe(false);
    expect(sanitizePrWorkdirFooter(true)).toBe(true);
    // Absent key: every config file written before #872 must keep the feature on.
    expect(sanitizePrWorkdirFooter(undefined)).toBe(true);
    // "false" the STRING is not the opt-out — a hand-edited config that quotes it stays on,
    // which is the safe direction for a switch whose off state is silent.
    expect(sanitizePrWorkdirFooter("false")).toBe(true);
    expect(sanitizePrWorkdirFooter(0)).toBe(true);
    expect(sanitizePrWorkdirFooter(null)).toBe(true);
  });
});

describe("sanitizeFeedRefreshEnabled / sanitizeCalendarSyncEnabled", () => {
  // #2015 added these to switch OFF two tasks that have always run. The direction that matters
  // is the absent key: every config file written before this must keep both running, or a
  // workspace with feeds silently stops updating on upgrade.
  it("is false ONLY for the boolean false", () => {
    [sanitizeFeedRefreshEnabled, sanitizeCalendarSyncEnabled].forEach((sanitize) => {
      expect(sanitize(false)).toBe(false);
      expect(sanitize(true)).toBe(true);
      expect(sanitize(undefined)).toBe(true);
      // Same reasoning as `prWorkdirFooter`: a quoted "false" is not the opt-out, and staying on
      // is the safe direction for a switch whose off state is silent.
      expect(sanitize("false")).toBe(true);
      expect(sanitize(0)).toBe(true);
      expect(sanitize(null)).toBe(true);
    });
  });
});

describe("sanitizeRepos", () => {
  it("keeps trimmed owner/repo slugs, drops junk, de-dupes", () => {
    expect(sanitizeRepos(["  a/b ", "c/d", "a/b", "no-slash", 5, "bad name/repo"])).toEqual(["a/b", "c/d"]);
    expect(sanitizeRepos("nope")).toEqual([]);
    expect(sanitizeRepos(undefined)).toEqual([]);
  });

  // Deliberate widening (#981): a third segment used to be rejected here, which meant a
  // `host/owner/repo` entry could not be SAVED at all. What an entry means — which forge, and
  // whether that forge is implemented — is `forgeFromRepoEntry` / `repoSupport`, not this.
  it("keeps a host-qualified entry, and a GitLab group path of any depth", () => {
    expect(sanitizeRepos(["gitlab.com/group/project", "gitlab.com/group/sub/project"])).toEqual(["gitlab.com/group/project", "gitlab.com/group/sub/project"]);
  });

  it("still rejects anything that is not a slug path", () => {
    expect(sanitizeRepos(["one", "has space/repo", "a//b", "/leading", "trailing/"])).toEqual([]);
  });

  // What may be stored is exactly what the parser can read, so an ambiguous entry never reaches a
  // CLI: `gh --repo a/b/c` would target host `a` while this side called it a GitHub path
  // (Codex review).
  it("rejects a hostless entry with more than two segments", () => {
    expect(sanitizeRepos(["a/b/c", "owner/repo/extra"])).toEqual([]);
  });
});

describe("sanitizeRepoDirs", () => {
  it("keeps owner/repo keys pointing at absolute paths, trimmed", () => {
    expect(sanitizeRepoDirs({ "a/b": "  /w/ab  ", " c/d ": "/w/cd" })).toEqual({ "a/b": "/w/ab", "c/d": "/w/cd" });
  });

  // A relative path would be resolved against the SERVER's cwd and name a directory the user
  // never picked — the same rule the presets follow.
  it.each([
    ["a relative path", { "a/b": "w/ab" }],
    ["a non-string value", { "a/b": 5 }],
    ["a key that is not owner/repo", { "no-slash": "/w/x" }],
    ["a key with a space", { "bad name/repo": "/w/x" }],
  ])("drops %s", (_case, input) => {
    expect(sanitizeRepoDirs(input)).toEqual({});
  });

  // Widened with `prRepos` (#981), and for the same reason: the repo a recorded clone belongs to
  // can now be written `host/owner/repo`, so a key with a longer path is a real entry rather than
  // a malformed one.
  it("keeps a host-qualified key", () => {
    expect(sanitizeRepoDirs({ "gitlab.com/group/project": "/w/p" })).toEqual({ "gitlab.com/group/project": "/w/p" });
  });

  // The deletion-by-malformed-body trap this field shares with `sounds`: an array sanitizes to
  // `{}`, which the merge would apply as "the user cleared every choice". `config-body` rejects
  // it before that, and this pins what the sanitizer alone would have done.
  it.each([
    ["an array", []],
    ["a string", "nope"],
    ["undefined", undefined],
    ["null", null],
  ])("is empty for %s", (_case, input) => {
    expect(sanitizeRepoDirs(input)).toEqual({});
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

describe("sanitizeCustomAgents (#1414)", () => {
  it("keeps trimmed id+label+command triples, drops incomplete/dup/junk", () => {
    expect(
      sanitizeCustomAgents([
        { id: " nemotron ", label: "  Nemotron ", agent: "claude", command: " ollama launch claude --model nemotron-3-ultra:cloud -- " },
        { id: "kimi", label: "Kimi", agent: "claude", command: "kimi-claude" },
        { id: "nemotron", label: "Again", agent: "claude", command: "x" }, // dup ID — dropped
        { id: "noCmd", label: "NoCmd", agent: "claude", command: "" }, // no command — dropped
        { id: "nolabel", label: "", agent: "claude", command: "x" }, // no label — dropped
        { id: "noagent", label: "NoAgent", command: "x" }, // does not say WHICH agent — dropped
        "junk",
      ]),
    ).toEqual([
      { id: "nemotron", label: "Nemotron", agent: "claude" as const, command: "ollama launch claude --model nemotron-3-ultra:cloud --" },
      { id: "kimi", label: "Kimi", agent: "claude", command: "kimi-claude" },
    ]);
    expect(sanitizeCustomAgents("nope")).toEqual([]);
    expect(sanitizeCustomAgents(undefined)).toEqual([]);
  });

  // Its button would be shadowed by the built-in one and never reachable, which looks exactly
  // like the entry having been ignored — so it is dropped where that can still be explained.
  it("drops an entry that names itself after a built-in picker option", () => {
    expect(sanitizeCustomAgents([{ id: "claude", label: "Mine", agent: "claude", command: "x" }])).toEqual([]);
    expect(sanitizeCustomAgents([{ id: "shell", label: "Mine", agent: "claude", command: "x" }])).toEqual([]);
  });

  it("caps the number of custom agents", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, label: `A${i}`, agent: "claude", command: `c${i}` }));
    expect(sanitizeCustomAgents(many).length).toBeLessThanOrEqual(8);
  });
});

describe("sanitizeQuickCommands", () => {
  it("keeps trimmed label+text pairs, drops incomplete/dup/junk", () => {
    expect(
      sanitizeQuickCommands([
        { label: "  PR ", text: " PR作って " },
        { label: "merge", text: "mergeして" },
        { label: "PR", text: "again" }, // dup label — dropped
        { label: "NoText", text: "   " }, // text is only whitespace — dropped
        { label: "", text: "x" }, // no label — dropped
        "junk",
      ]),
    ).toEqual([
      { label: "PR", text: "PR作って" },
      { label: "merge", text: "mergeして" },
    ]);
    expect(sanitizeQuickCommands("nope")).toEqual([]);
    expect(sanitizeQuickCommands(undefined)).toEqual([]);
  });

  it("keeps a valid agents scope and de-duplicates it", () => {
    expect(sanitizeQuickCommands([{ label: "PR", text: "t", agents: ["claude", "claude", "codex"] }])).toEqual([
      { label: "PR", text: "t", agents: ["claude", "codex"] },
    ]);
  });

  // An empty scope must mean the same as no scope — "offered to nothing" is never what a user
  // meant, and it would hide the command with no way to see why.
  it("drops the agents key when the scope is empty", () => {
    expect(sanitizeQuickCommands([{ label: "PR", text: "t", agents: [] }])).toEqual([{ label: "PR", text: "t" }]);
    expect(Object.keys(sanitizeQuickCommands([{ label: "PR", text: "t", agents: [] }])[0])).toEqual(["label", "text"]);
  });

  it("rejects an entry whose agents name a kind that does not exist", () => {
    expect(sanitizeQuickCommands([{ label: "PR", text: "t", agents: ["gemini"] }])).toEqual([]);
  });

  // The label has to fit a phone chip, and the text is bounded like a launcher command.
  it("caps the label and text lengths, and the number of commands", () => {
    const [only] = sanitizeQuickCommands([{ label: "L".repeat(80), text: "T".repeat(900) }]);
    expect(only.label).toHaveLength(24);
    expect(only.text).toHaveLength(500);
    const many = Array.from({ length: 30 }, (_, i) => ({ label: `Q${i}`, text: `t${i}` }));
    expect(sanitizeQuickCommands(many).length).toBeLessThanOrEqual(20);
  });
});

describe("sanitizePushKinds", () => {
  it("keeps the kinds that exist and drops anything else", () => {
    expect(sanitizePushKinds(["finished", "nope", 7, null])).toEqual(["finished"]);
    expect(sanitizePushKinds(["waiting"])).toEqual(["waiting"]);
  });

  // The stored file should read the same however the checkboxes were clicked.
  it("normalises to the canonical order and de-duplicates", () => {
    expect(sanitizePushKinds(["waiting", "finished", "waiting"])).toEqual(["finished", "waiting"]);
  });

  // A config written before the setting existed has no `pushKinds` — an upgrading user must not
  // silently lose the notifications they already had.
  it("falls back to the defaults when the field is absent or not an array", () => {
    expect(sanitizePushKinds(undefined)).toEqual(["finished", "waiting"]);
    expect(sanitizePushKinds("finished")).toEqual(["finished", "waiting"]);
    expect(sanitizePushKinds({ finished: true })).toEqual(["finished", "waiting"]);
  });

  // Distinct from "absent": the user turned every kind off but left the master switch alone.
  // Collapsing this to the defaults would make that choice impossible to express.
  it("keeps an explicit empty list", () => {
    expect(sanitizePushKinds([])).toEqual([]);
  });

  it("returns a fresh array, so a caller mutating it cannot corrupt the defaults", () => {
    const first = sanitizePushKinds(undefined);
    first.pop();
    expect(sanitizePushKinds(undefined)).toEqual(["finished", "waiting"]);
  });
});

describe("sanitizeUserMcpServers", () => {
  it("keeps valid id + http(s) url, drops bad id/url/dup", () => {
    expect(
      sanitizeUserMcpServers([
        { id: " weather ", url: " http://localhost:9000/mcp " },
        { id: "docs", url: "https://example.com/mcp" },
        { id: "weather", url: "https://x/mcp" }, // dup id — dropped
        { id: "bad id", url: "https://x/mcp" }, // space in id — dropped
        { id: "noscheme", url: "example.com/mcp" }, // not http(s) — dropped
        "junk",
      ]),
    ).toEqual([
      { id: "weather", url: "http://localhost:9000/mcp" },
      { id: "docs", url: "https://example.com/mcp" },
    ]);
    expect(sanitizeUserMcpServers("nope")).toEqual([]);
  });
  // KEPT, not dropped. The sanitized config is what a later save writes back, so dropping a
  // clashing entry would erase a server from the user's own file — permanently, and as a
  // side-effect of changing some unrelated setting. `mt` was a legal id before this release
  // (Codex review on #1355). It cannot win at spawn — mcpConfigJson writes the built-in last —
  // and that is where the collision is settled, not here.
  it("keeps a user entry that clashes with a built-in GUI MCP id instead of erasing it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(sanitizeUserMcpServers([{ id: "mt", url: "https://mine/mcp" }])).toEqual([{ id: "mt", url: "https://mine/mcp" }]);
      expect(sanitizeUserMcpServers([{ id: "mulmoterminal-gui", url: "https://mine/mcp" }])).toEqual([{ id: "mulmoterminal-gui", url: "https://mine/mcp" }]);
    } finally {
      warn.mockRestore();
    }
  });
  // Well-formed and still unreachable is the one case worth a line in the log: the symptom is a
  // server that is present in the config and absent in the session. The other rejections are
  // visibly malformed and stay silent.
  //
  // And the LEGACY id must stay silent too (Codex review, second pass): mcpConfigJson overwrites
  // GUI_SERVER_ID and nothing else, so a server someone still calls `mulmoterminal-gui` is
  // reachable and works. Warning there tells them to rename something that is fine.
  it("says so only for the id the built-in actually overwrites", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      sanitizeUserMcpServers([{ id: "mt", url: "https://mine/mcp" }]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("mt");
      warn.mockClear();
      sanitizeUserMcpServers([{ id: "mulmoterminal-gui", url: "https://mine/mcp" }]);
      expect(warn).not.toHaveBeenCalled();
      sanitizeUserMcpServers([
        { id: "bad id", url: "https://mine/mcp" },
        { id: "ok", url: "not-a-url" },
      ]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("sanitizeWorklogIntervalHours", () => {
  it("clamps to whole hours in [1,168]; non-positive / non-number => default 6", () => {
    expect(sanitizeWorklogIntervalHours(6)).toBe(6);
    expect(sanitizeWorklogIntervalHours(24)).toBe(24);
    expect(sanitizeWorklogIntervalHours(1000)).toBe(168); // clamp max
    expect(sanitizeWorklogIntervalHours(2.6)).toBe(3); // round
    expect(sanitizeWorklogIntervalHours(0)).toBe(6); // non-positive => default
    expect(sanitizeWorklogIntervalHours(-5)).toBe(6);
    expect(sanitizeWorklogIntervalHours("x")).toBe(6);
    expect(sanitizeWorklogIntervalHours(undefined)).toBe(6);
  });
});

describe("sanitizeTerminalSubmit", () => {
  it("keeps a known mode; anything else falls back to the standard 'cr'", () => {
    expect(sanitizeTerminalSubmit("cr")).toBe("cr");
    expect(sanitizeTerminalSubmit("esc-cr")).toBe("esc-cr");
    expect(sanitizeTerminalSubmit("CR")).toBe("cr"); // case-sensitive
    expect(sanitizeTerminalSubmit("bogus")).toBe("cr");
    expect(sanitizeTerminalSubmit("")).toBe("cr");
    expect(sanitizeTerminalSubmit(1)).toBe("cr");
    expect(sanitizeTerminalSubmit(null)).toBe("cr");
    expect(sanitizeTerminalSubmit(undefined)).toBe("cr");
  });
});

describe("loadAppConfig / saveAppConfig", () => {
  const base = {
    cwdPresets: [],
    soundFile: null,
    soundKinds: [...DEFAULT_SOUND_KINDS],
    sounds: {},
    prRepos: [],
    gitlabHosts: [],
    repoDirs: {},
    launchers: [],
    customAgents: [],
    quickCommands: [],
    userMcpServers: [],
    themes: [],
    buttons: null,
    chips: null,
    pushEnabled: false,
    pushKinds: [...DEFAULT_PUSH_KINDS],
    worklogEnabled: false,
    feedRefreshEnabled: true,
    calendarSyncEnabled: true,
    worklogIntervalHours: 6,
    sessionIdleReapDays: 7,
    providers: [],
    terminalSubmit: "cr",
    keymap: {},
    copyOnSelect: false,
    decisionDigest: false,
    questionPaneEnabled: false,
    issueWorkComments: false,
    prWorkdirFooter: true,
    appendSystemPrompt: true,
    autoDirIcon: true,
    showLoadAverage: true,
    toolbarPins: [],
    cockpitLines: { ...DEFAULT_COCKPIT_LINES },
    headerStatusColors: {},
    headerStatusTint: DEFAULT_HEADER_STATUS_TINT,
    fontFamily: null,
  };
  it("round-trips presets + soundFile + prRepos + launchers + userMcpServers through a file", () => {
    const dir = tmp();
    const file = path.join(dir, "nested", "config.json"); // nested → mkdir is exercised
    const cfg = {
      // Canonical already: saving canonicalises (#1002), and on Windows that adds the current
      // drive — a POSIX literal here would not survive its own round trip.
      cwdPresets: [{ label: "x", path: path.resolve("/x") }],
      soundFile: "/s.wav",
      soundKinds: [...DEFAULT_SOUND_KINDS],
      sounds: {},
      prRepos: ["o/r"],
      gitlabHosts: ["gitlab.hogefuga.com"], // config.json-only, so the file is its only way home
      repoDirs: {},
      launchers: [{ label: "Shell", command: "$SHELL" }],
      customAgents: [{ id: "nemotron", label: "Nemotron", agent: "claude" as const, command: "ollama launch claude --model nemotron-3-ultra:cloud --" }],
      quickCommands: [],
      userMcpServers: [{ id: "weather", url: "http://localhost:9000/mcp" }],
      themes: [],
      buttons: [{ id: "pr", label: "PR", run: "shell" as const, cmd: "gh pr create" }],
      chips: ["dir", "git"],
      pushEnabled: true,
      pushKinds: [...DEFAULT_PUSH_KINDS],
      worklogEnabled: true,
      feedRefreshEnabled: true,
      calendarSyncEnabled: true,
      worklogIntervalHours: 12,
      sessionIdleReapDays: 7,
      providers: [],
      terminalSubmit: "esc-cr" as const, // a non-default value must round-trip through the file
      keymap: { "zoom-next": "PageDown" }, // a bound shortcut must survive the round-trip too
      copyOnSelect: true,
      decisionDigest: true, // opt-in, so only `true` proves it persisted rather than defaulted
      questionPaneEnabled: false,
      issueWorkComments: false, // opt-in, so only `true` proves it persisted rather than defaulted
      prWorkdirFooter: false, // the opt-out: it defaults ON, so only `false` proves it persisted
      appendSystemPrompt: false, // same opt-out shape: defaults ON, so only `false` proves it persisted
      autoDirIcon: false, // same again (#1428): defaults ON, so only `false` proves it persisted
      showLoadAverage: false, // the same opt-out shape (#1786): only `false` proves it persisted
      toolbarPins: ["collection:works"], // opt-in (#1984): only a promoted pin proves it persisted
      cockpitLines: { summary: 6, prompt: 2, response: 3 }, // a raised clamp must survive it too
      headerStatusColors: { working: { background: "#6d28d9", text: null } }, // a per-status header colour must round-trip too
      headerStatusTint: "none" as const, // non-default, so only "none" proves it persisted
      fontFamily: "Cica, monospace", // already normalized, so it must come back byte-identical
    };
    expect(saveAppConfig(file, cfg, {})).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(cfg);
    expect(loadAppConfig(file)).toEqual(cfg);
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to empty presets + null sound + empty repos/launchers/mcp for a missing file", () => {
    const dir = tmp();
    expect(loadAppConfig(path.join(dir, "none.json"))).toEqual(base);
    rmSync(dir, { recursive: true, force: true });
  });

  it("sanitizes junk presets, a non-string sound, bad repos/launchers/mcp on load", () => {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        cwdPresets: [{ label: "a", path: "/a" }, "junk"],
        soundFile: 5,
        prRepos: ["o/r", "bad"],
        gitlabHosts: ["GitLab.Hogefuga.com", "https://gitlab.two.example/", "not a host", 5], // case, a pasted URL, junk
        launchers: [{ label: "S", command: "sh" }, "x"],
        userMcpServers: [
          { id: "ok", url: "https://x/mcp" },
          { id: "bad url", url: "nope" },
        ],
        terminalSubmit: "bogus", // unknown mode => standard 'cr'
        fontFamily: "Cica; color: red", // CSS syntax => dropped, not passed to the browser
        keymap: { "zoom-next": "PageDown", "warp-drive": "F1", "zoom-prev": "Shift+" }, // unknown action + bad binding are dropped
      }),
    );
    expect(loadAppConfig(file)).toEqual({
      cwdPresets: [{ label: "a", path: path.resolve("/a") }],
      soundFile: null,
      soundKinds: [...DEFAULT_SOUND_KINDS],
      sounds: {},
      prRepos: ["o/r"],
      gitlabHosts: ["gitlab.hogefuga.com", "gitlab.two.example"],
      repoDirs: {},
      launchers: [{ label: "S", command: "sh" }],
      customAgents: [],
      quickCommands: [],
      userMcpServers: [{ id: "ok", url: "https://x/mcp" }],
      themes: [],
      keymap: { "zoom-next": "PageDown" },
      cockpitLines: { ...DEFAULT_COCKPIT_LINES },
      headerStatusColors: {},
      headerStatusTint: DEFAULT_HEADER_STATUS_TINT,
      buttons: null,
      chips: null,
      pushEnabled: false,
      pushKinds: [...DEFAULT_PUSH_KINDS],
      worklogEnabled: false,
      feedRefreshEnabled: true,
      calendarSyncEnabled: true,
      worklogIntervalHours: 6,
      sessionIdleReapDays: 7,
      providers: [],
      terminalSubmit: "cr",
      copyOnSelect: false,
      decisionDigest: false,
      questionPaneEnabled: false,
      issueWorkComments: false,
      prWorkdirFooter: true, // absent from the file — every config predating #872 stays enabled
      appendSystemPrompt: true, // absent from the file — every config predating #1062 stays enabled
      autoDirIcon: true, // same: a config predating #1428 picks up the repo's own favicon
      showLoadAverage: true, // same: a config predating #1786 gets the load read-out
      toolbarPins: [], // opt-in the other way (#1984): a config that predates it promotes nothing
      fontFamily: null,
    });
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns defaults for invalid JSON (lenient boot load)", () => {
    const dir = tmp();
    const file = path.join(dir, "bad.json");
    writeFileSync(file, "{ not json");
    expect(loadAppConfig(file)).toEqual(base);
    rmSync(dir, { recursive: true, force: true });
  });

  it("preserves the legacy presets-only shape (other fields absent => defaults)", () => {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ cwdPresets: [{ label: "a", path: "/a" }] }));
    expect(loadAppConfig(file)).toEqual({ ...base, cwdPresets: [{ label: "a", path: path.resolve("/a") }] });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("loadAppConfigResult (missing vs corrupt vs ok)", () => {
  it("reports a missing file as missing, not corrupt", () => {
    const dir = tmp();
    expect(loadAppConfigResult(path.join(dir, "none.json"))).toEqual({ status: "missing" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports unparseable JSON as corrupt (distinct from missing)", () => {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    // A single trailing comma — the realistic hand-edit that triggered #741.
    writeFileSync(file, '{ "pushEnabled": true, }');
    const loaded = loadAppConfigResult(file);
    expect(loaded.status).toBe("corrupt");
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the sanitized config for a good file", () => {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    writeFileSync(file, JSON.stringify({ cwdPresets: [{ label: "a", path: "/a" }], pushEnabled: true }));
    const loaded = loadAppConfigResult(file);
    expect(loaded).toMatchObject({ status: "ok", config: { cwdPresets: [{ label: "a", path: path.resolve("/a") }], pushEnabled: true } });
    rmSync(dir, { recursive: true, force: true });
  });

  // The write path uses emptyConfig() as the base for a MISSING file instead of a second
  // loadAppConfig() read (which could race a concurrent write turning it corrupt in between).
  // A missing-file merge must therefore behave exactly like merging onto empty.
  it("emptyConfig is a fresh default base equal to loading a missing file", () => {
    const dir = tmp();
    expect(emptyConfig()).toEqual(loadAppConfig(path.join(dir, "none.json")));
    // fresh object each call (callers mutate in place)
    expect(emptyConfig()).not.toBe(emptyConfig());
    const merged = mergeConfigUpdate(emptyConfig(), { pushEnabled: true });
    expect(merged).toEqual({ ...emptyConfig(), pushEnabled: true });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("backupCorruptConfig", () => {
  it("copies the unreadable file aside so it isn't lost when the caller refuses the write", () => {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    writeFileSync(file, "{ not json");
    const bak = backupCorruptConfig(file);
    expect(bak).toBe(`${file}.corrupt.bak`);
    expect(bak && readFileSync(bak, "utf8")).toBe("{ not json");
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null (best-effort) when the source can't be copied", () => {
    const dir = tmp();
    expect(backupCorruptConfig(path.join(dir, "does-not-exist.json"))).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});

// The core #741 hazard as a scenario test: a corrupt file must not become the empty base
// that a merge writes back. This is what a POST /api/config write path must do.
describe("#741 corrupt config is not silently wiped by a partial update", () => {
  const richConfig = {
    cwdPresets: [{ label: "proj", path: path.resolve("/proj") }],
    soundFile: null,
    soundKinds: [...DEFAULT_SOUND_KINDS],
    sounds: {},
    prRepos: ["o/r"],
    gitlabHosts: ["gitlab.hogefuga.com"],
    repoDirs: {},
    launchers: [{ label: "Shell", command: "$SHELL" }],
    customAgents: [{ id: "nemotron", label: "Nemotron", agent: "claude" as const, command: "ollama launch claude --model nemotron-3-ultra:cloud --" }],
    quickCommands: [],
    userMcpServers: [{ id: "weather", url: "http://localhost:9000/mcp" }],
    themes: [],
    buttons: null,
    chips: null,
    pushEnabled: false,
    pushKinds: [...DEFAULT_PUSH_KINDS],
    worklogEnabled: false,
    feedRefreshEnabled: true,
    calendarSyncEnabled: true,
    worklogIntervalHours: 6,
    sessionIdleReapDays: 7,
    providers: [],
    terminalSubmit: "cr" as const,
    keymap: {},
    copyOnSelect: false,
    decisionDigest: false,
    questionPaneEnabled: false,
    issueWorkComments: false,
    prWorkdirFooter: true,
    appendSystemPrompt: true,
    autoDirIcon: true,
    showLoadAverage: true,
    toolbarPins: [],
    cockpitLines: { ...DEFAULT_COCKPIT_LINES },
    headerStatusColors: {},
    headerStatusTint: DEFAULT_HEADER_STATUS_TINT,
    fontFamily: null,
  };

  it("a valid base keeps every omitted field through a pushEnabled-only update", () => {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    saveAppConfig(file, richConfig, {});
    const loaded = loadAppConfigResult(file);
    expect(loaded.status).toBe("ok");
    const base = loaded.status === "ok" ? loaded.config : loadAppConfig(file);
    const next = mergeConfigUpdate(base, { pushEnabled: true });
    expect(next).toEqual({ ...richConfig, pushEnabled: true });
    expect(next.cwdPresets).toEqual(richConfig.cwdPresets);
    expect(next.launchers).toEqual(richConfig.launchers);
    rmSync(dir, { recursive: true, force: true });
  });

  it("a corrupt base is caught BEFORE merge, so the write path can refuse instead of wiping", () => {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    saveAppConfig(file, richConfig, {});
    // Corrupt it the way a hand-edit would (append a stray token).
    writeFileSync(file, readFileSync(file, "utf8") + "  oops");
    const loaded = loadAppConfigResult(file);
    expect(loaded.status).toBe("corrupt");
    // The write path refuses here — but if it had fallen through to the OLD lenient load,
    // the merge base would have been empty and every rich field erased. Prove that gap:
    const wipedBase = loadAppConfig(file); // lenient path returns empty on corrupt
    const wouldWipe = mergeConfigUpdate(wipedBase, { pushEnabled: true });
    expect(wouldWipe.cwdPresets).toEqual([]); // <- the regression the fix prevents
    expect(wouldWipe.launchers).toEqual([]);
    // And the corrupt file can be preserved rather than lost.
    const bak = backupCorruptConfig(file);
    expect(bak && existsSync(bak)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("mergeConfigUpdate", () => {
  const baseConfig = (over: Partial<AppConfig> = {}): AppConfig => ({
    cwdPresets: [],
    soundFile: null,
    soundKinds: [...DEFAULT_SOUND_KINDS],
    sounds: {},
    prRepos: [],
    gitlabHosts: [],
    repoDirs: {},
    launchers: [],
    customAgents: [],
    quickCommands: [],
    userMcpServers: [],
    themes: [],
    buttons: [{ id: "reveal", label: "Reveal in the file manager", run: "open", emoji: "📂", open: { reveal: "${dir}" } }],
    chips: ["git", "diff", "ctx", "usage"],
    pushEnabled: false,
    pushKinds: [...DEFAULT_PUSH_KINDS],
    worklogEnabled: false,
    feedRefreshEnabled: true,
    calendarSyncEnabled: true,
    worklogIntervalHours: 6,
    sessionIdleReapDays: 7,
    providers: [],
    terminalSubmit: "cr",
    keymap: {},
    copyOnSelect: false,
    decisionDigest: false,
    questionPaneEnabled: false,
    issueWorkComments: false,
    prWorkdirFooter: true,
    appendSystemPrompt: true,
    autoDirIcon: true,
    showLoadAverage: true,
    toolbarPins: [],
    cockpitLines: { ...DEFAULT_COCKPIT_LINES },
    headerStatusColors: {},
    headerStatusTint: DEFAULT_HEADER_STATUS_TINT,
    fontFamily: null,
    ...over,
  });

  it("applies a field present in the body", () => {
    expect(mergeConfigUpdate(baseConfig(), { chips: ["git", "diff"] }).chips).toEqual(["git", "diff"]);
  });

  it("keeps fields the body omits — a chips-only update must NOT wipe buttons", () => {
    const base = baseConfig();
    expect(mergeConfigUpdate(base, { chips: ["git"] }).buttons).toEqual(base.buttons);
  });

  it("applies pushEnabled from the body and keeps it when omitted", () => {
    expect(mergeConfigUpdate(baseConfig(), { pushEnabled: true }).pushEnabled).toBe(true);
    expect(mergeConfigUpdate(baseConfig({ pushEnabled: true }), { chips: ["git"] }).pushEnabled).toBe(true);
  });

  it("applies worklog settings from the body and keeps them when omitted", () => {
    const next = mergeConfigUpdate(baseConfig(), { worklogEnabled: true, worklogIntervalHours: 12 });
    expect(next.worklogEnabled).toBe(true);
    expect(next.worklogIntervalHours).toBe(12);
    // a chips-only update must not reset worklog
    expect(mergeConfigUpdate(baseConfig({ worklogEnabled: true }), { chips: ["git"] }).worklogEnabled).toBe(true);
  });

  it("applies terminalSubmit from the body (sanitized) and keeps it when omitted", () => {
    expect(mergeConfigUpdate(baseConfig(), { copyOnSelect: true }).copyOnSelect).toBe(true);
    expect(mergeConfigUpdate(baseConfig({ copyOnSelect: true }), { chips: ["git"] }).copyOnSelect).toBe(true);
    expect(mergeConfigUpdate(baseConfig(), { terminalSubmit: "esc-cr" }).terminalSubmit).toBe("esc-cr");
    expect(mergeConfigUpdate(baseConfig(), { terminalSubmit: "bogus" }).terminalSubmit).toBe("cr"); // invalid => default
    // a chips-only update must not reset the mapping
    expect(mergeConfigUpdate(baseConfig({ terminalSubmit: "esc-cr" }), { chips: ["git"] }).terminalSubmit).toBe("esc-cr");
  });

  it("applies prWorkdirFooter from the body and keeps it when omitted", () => {
    expect(mergeConfigUpdate(baseConfig(), { prWorkdirFooter: false }).prWorkdirFooter).toBe(false);
    // The opt-out must survive an unrelated update, or the next Settings save re-enables it.
    expect(mergeConfigUpdate(baseConfig({ prWorkdirFooter: false }), { chips: ["git"] }).prWorkdirFooter).toBe(false);
  });

  // #1062. No Settings UI writes this one either, so an omitting POST is the whole risk: the
  // user hand-edits `false`, presses an unrelated Save, and the instruction comes back.
  it("applies appendSystemPrompt from the body and keeps it when omitted", () => {
    expect(mergeConfigUpdate(baseConfig(), { appendSystemPrompt: false }).appendSystemPrompt).toBe(false);
    expect(mergeConfigUpdate(baseConfig({ appendSystemPrompt: false }), { chips: ["git"] }).appendSystemPrompt).toBe(false);
    // A string is the planned third value; until it is accepted it must not read as the opt-out.
    expect(mergeConfigUpdate(baseConfig(), { appendSystemPrompt: "custom text" }).appendSystemPrompt).toBe(true);
  });

  // No Settings UI writes this one, so the merge path is the only thing standing between a
  // POST that omits it and the user's configured font disappearing.
  it("applies fontFamily from the body (normalized) and keeps it when omitted", () => {
    expect(mergeConfigUpdate(baseConfig(), { fontFamily: "Cica" }).fontFamily).toBe("Cica, monospace");
    expect(mergeConfigUpdate(baseConfig(), { fontFamily: "Cica; color: red" }).fontFamily).toBeNull(); // invalid => unset
    expect(mergeConfigUpdate(baseConfig({ fontFamily: "Cica, monospace" }), { chips: ["git"] }).fontFamily).toBe("Cica, monospace");
  });

  it("merging on a RE-READ disk base preserves another instance's write (the clobber fix)", () => {
    const dir = tmp();
    const file = path.join(dir, "config.json");
    try {
      // "Another instance" persisted a full config (buttons + chips) to the shared file.
      saveAppConfig(file, baseConfig(), {});
      // A stale instance handles a chips-only POST: base must come from the re-read disk,
      // not its boot-time memory — so the disk's buttons survive.
      const disk = loadAppConfig(file);
      const next = mergeConfigUpdate(disk, { chips: ["git", "diff"] });
      expect(next.buttons).toEqual(disk.buttons);
      expect(next.chips).toEqual(["git", "diff"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
