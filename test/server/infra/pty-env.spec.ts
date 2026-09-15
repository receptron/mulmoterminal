// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  inheritedPtyEnv,
  isLauncherEnvVar,
  isLauncherPathEntry,
  isPathVar,
  pathFromEnv,
  sanitizePathEntries,
  sanitizePtyEnv,
  withFallbackLocale,
} from "../../../server/infra/pty-env";

describe("isLauncherEnvVar", () => {
  it("flags the vars package-manager launchers inject", () => {
    for (const name of [
      "PREFIX",
      "INIT_CWD",
      "NODE",
      "PROJECT_CWD",
      "BERRY_BIN_FOLDER",
      "npm_execpath",
      "npm_node_execpath",
      "npm_command",
      "npm_config_registry",
      "npm_config_user_agent",
      "npm_package_name",
      "npm_package_scripts_dev",
      "npm_lifecycle_event",
      "npm_lifecycle_script",
    ]) {
      expect(isLauncherEnvVar(name), name).toBe(true);
    }
  });

  it("matches case-insensitively (Windows env names are case-insensitive)", () => {
    for (const name of ["Prefix", "prefix", "Init_Cwd", "Node", "NPM_CONFIG_REGISTRY", "Npm_Package_Name", "NPM_EXECPATH"]) {
      expect(isLauncherEnvVar(name), name).toBe(true);
    }
  });

  // NODE_ENV stays on this list on purpose. It reached PTYs as "production" until #955, which
  // was the launcher exporting it — fixed there. Adding it here instead would take away the
  // NODE_ENV of a user who exports one, which is a different bug with the same shape.
  it("keeps real user environment, including other *_PREFIX vars", () => {
    for (const name of ["HOMEBREW_PREFIX", "CONDA_PREFIX", "HOME", "SHELL", "PATH", "NVM_DIR", "NODE_ENV", "NODE_OPTIONS"]) {
      expect(isLauncherEnvVar(name), name).toBe(false);
    }
  });
});

describe("sanitizePathEntries", () => {
  const NVM_BIN = "/Users/u/.nvm/versions/node/v22.18.0/bin";

  it("drops yarn temp shims, node_modules/.bin and node-gyp-bin, keeps the rest in order", () => {
    const dirty = [
      "/Users/u/Library/Caches/yarn--1784555760742-0.153931",
      "/repo/node_modules/.bin",
      "/Users/u/.config/yarn/link/node_modules/.bin",
      "/Users/u/.nvm/versions/node/v22.18.0/lib/node_modules/npm/bin/node-gyp-bin",
      NVM_BIN,
      "/opt/homebrew/bin",
      "/usr/bin",
    ].join(":");
    expect(sanitizePathEntries(dirty, ":")).toBe([NVM_BIN, "/opt/homebrew/bin", "/usr/bin"].join(":"));
  });

  it("handles windows-style separators and delimiter", () => {
    const dirty = ["C:\\repo\\node_modules\\.bin", "C:\\yarn-cache\\yarn--123-abc", "C:\\Windows\\system32"].join(";");
    expect(sanitizePathEntries(dirty, ";")).toBe("C:\\Windows\\system32");
  });

  // Regression: matching is on the entry's LAST segment. A shim-like name in an
  // ANCESTOR used to take the whole entry down with it.
  it.each([
    ["the shim name is an ancestor, not the entry itself", "/repo/node_modules/.bin/tools:/repo/tools/bin"],
    ["a yarn-shim-like ancestor was named by a human", "/Users/u/yarn--2-experiments/bin:/Users/u/node-gyp-bin/src:/usr/bin"],
    ["a bare .bin has a parent other than node_modules", "/Users/u/tools/.bin:/usr/bin"],
    ["entries are empty (they keep their positions)", "/usr/bin::/bin"],
    ["an entry names no directory at all", "/usr/bin:/:/bin"],
  ])("keeps the PATH untouched when %s", (_case, p) => {
    expect(sanitizePathEntries(p, ":")).toBe(p);
  });

  it("drops entries with a trailing separator", () => {
    expect(sanitizePathEntries("/repo/node_modules/.bin/:/usr/bin", ":")).toBe("/usr/bin");
    expect(sanitizePathEntries("C:\\repo\\node_modules\\.bin\\;C:\\Windows", ";")).toBe("C:\\Windows");
  });

  it("drops a relative node_modules/.bin entry (no leading separator)", () => {
    expect(sanitizePathEntries("node_modules/.bin:/usr/bin", ":")).toBe("/usr/bin");
  });
});

describe("isPathVar", () => {
  it("matches PATH in any casing (Windows spells it Path)", () => {
    for (const name of ["PATH", "Path", "path"]) expect(isPathVar(name), name).toBe(true);
  });

  it("does not match other vars that start with PATH", () => {
    for (const name of ["PATHEXT", "MANPATH", "PYTHONPATH"]) expect(isPathVar(name), name).toBe(false);
  });
});

describe("sanitizePtyEnv", () => {
  it("returns a clean copy without mutating the input", () => {
    const env: NodeJS.ProcessEnv = {
      PREFIX: "/opt/homebrew",
      npm_config_registry: "https://registry.yarnpkg.com",
      npm_package_name: "mulmoterminal",
      HOME: "/Users/u",
      SHELL: "/bin/zsh",
      HOMEBREW_PREFIX: "/opt/homebrew",
      PATH: "/repo/node_modules/.bin:/Users/u/.nvm/versions/node/v22.18.0/bin:/usr/bin",
    };
    const out = sanitizePtyEnv(env, ":");
    expect(out.PREFIX).toBeUndefined();
    expect(out.npm_config_registry).toBeUndefined();
    expect(out.npm_package_name).toBeUndefined();
    expect(out.HOME).toBe("/Users/u");
    expect(out.SHELL).toBe("/bin/zsh");
    expect(out.HOMEBREW_PREFIX).toBe("/opt/homebrew");
    expect(out.PATH).toBe("/Users/u/.nvm/versions/node/v22.18.0/bin:/usr/bin");
    expect(env.PREFIX).toBe("/opt/homebrew");
    expect(env.PATH).toContain("/repo/node_modules/.bin");
  });

  it("cleans a windows-cased Path key", () => {
    const out = sanitizePtyEnv({ Path: "C:\\repo\\node_modules\\.bin;C:\\Windows" }, ";");
    expect(out.Path).toBe("C:\\Windows");
  });
});

describe("pathFromEnv", () => {
  it("reads the search path whatever the key's casing is", () => {
    expect(pathFromEnv({ PATH: "/usr/bin" })).toBe("/usr/bin");
    expect(pathFromEnv({ Path: "C:\\Windows" })).toBe("C:\\Windows");
    expect(pathFromEnv({ path: "/usr/bin" })).toBe("/usr/bin");
  });

  it("is undefined when the env carries no search path", () => {
    expect(pathFromEnv({ HOME: "/Users/u", PATHEXT: ".COM;.EXE" })).toBeUndefined();
    expect(pathFromEnv({})).toBeUndefined();
  });

  it("survives an empty value rather than reporting it as absent", () => {
    expect(pathFromEnv({ Path: "" })).toBe("");
  });
});

describe("withFallbackLocale", () => {
  // A macOS GUI launch inherits launchd's environment, which names no locale, so everything
  // that reads one — an ncurses TUI, python's stdout — runs as if the terminal were ASCII (#1634).
  it("supplies a UTF-8 LANG when the environment names no locale", () => {
    expect(withFallbackLocale({ HOME: "/Users/u", PATH: "/usr/bin" }, "darwin").LANG).toBe("en_US.UTF-8");
    expect(withFallbackLocale({}, "darwin").LANG).toBe("en_US.UTF-8");
  });

  // A Linux box with no locale named usually has no en_US.UTF-8 installed either, and naming
  // one that does not resolve trades a silent C locale for a failing one.
  it("adds nothing on Linux, where the name is not certain to resolve", () => {
    expect(withFallbackLocale({}, "linux").LANG).toBeUndefined();
    expect(withFallbackLocale({ HOME: "/home/u" }, "linux")).toEqual({ HOME: "/home/u" });
  });

  it("leaves the user's own locale alone, whichever variable carries it", () => {
    expect(withFallbackLocale({ LANG: "ja_JP.UTF-8" }, "darwin").LANG).toBe("ja_JP.UTF-8");
    expect(withFallbackLocale({ LANG: "C" }, "darwin").LANG).toBe("C");
    // LC_ALL and LC_CTYPE outrank LANG, so writing LANG could not change these anyway.
    expect(withFallbackLocale({ LC_ALL: "en_GB.UTF-8" }, "darwin").LANG).toBeUndefined();
    expect(withFallbackLocale({ LC_CTYPE: "en_GB.UTF-8" }, "darwin").LANG).toBeUndefined();
  });

  // A login shell can export a bare `LANG=` beside a real LC_ALL.
  it("does not count an empty value as naming a locale", () => {
    expect(withFallbackLocale({ LANG: "" }, "darwin").LANG).toBe("en_US.UTF-8");
    expect(withFallbackLocale({ LANG: "", LC_ALL: "ja_JP.UTF-8" }, "darwin").LANG).toBe("");
  });

  // Windows has neither the convention nor tmux, and git-bash reads LANG: introducing a
  // variable that was never there is a different bug waiting to happen.
  it("adds nothing on Windows", () => {
    expect(withFallbackLocale({ Path: "C:\\Windows" }, "win32").LANG).toBeUndefined();
  });

  it("never mutates the environment it was given", () => {
    const env = { HOME: "/Users/u" };
    withFallbackLocale(env, "darwin");
    expect(env).toEqual({ HOME: "/Users/u" });
  });
});

// `inheritedPtyEnv` is the composition `ptyEnv` used to spell out inline, lifted so the availability
// route can ask the same question without importing the spawn (PR #2085, round 4). The lift was
// proved behaviour-preserving by running the old composition beside it over 3,420 generated
// environments — 0 mismatches. What survives that harness is the GENERATOR below and the PROPERTY it
// established, because half the harness was code that no longer exists.
describe("inheritedPtyEnv", () => {
  // Per DELIMITER: a `:`-joined PATH cannot carry `C:\\tools`, because it splits at the drive colon.
  const PIECES: Record<string, string[]> = {
    ":": ["/usr/bin", "/opt/homebrew/bin", "/x/node_modules/.bin", "/x/node-gyp-bin", "/tmp/yarn--1700000000000-0.1", "", "/"],
    ";": ["C:\\Windows", "C:\\tools", "D:\\p\\node_modules\\.bin", "C:\\Temp\\yarn--1700000000000-0.1", ""],
  };
  const PLATFORMS: NodeJS.Platform[] = ["darwin", "linux", "win32"];
  const entriesOf = (value: string | undefined, delimiter: string): string[] => (value ?? "").split(delimiter).filter((entry) => entry !== "");

  const CASES: [NodeJS.Platform, string, number][] = PLATFORMS.flatMap((platform) =>
    Object.entries(PIECES).flatMap(([delimiter, pieces]) => pieces.map((_, n): [NodeJS.Platform, string, number] => [platform, delimiter, n])),
  );

  // `/` is KEPT: it names no directory of ours, which is what `isLauncherPathEntry` says about it.
  // The property is "drop OURS, keep everything else" — not "drop anything odd-looking".
  it.each(CASES)("keeps every user PATH entry and drops every run-script one (%s, %s, first %i+1)", (platform, delimiter, n) => {
    const before = (PIECES[delimiter] ?? []).slice(0, n + 1);
    const after = entriesOf(inheritedPtyEnv({ PATH: before.join(delimiter) }, platform, delimiter).PATH, delimiter);
    expect(after).toEqual(before.filter((entry) => entry !== "" && !isLauncherPathEntry(entry)));
  });

  // The locale half of the same composition: macOS only, and only when NOTHING names one — a user's
  // own LANG, and an LC_ALL beside an empty LANG, both have to survive.
  const LOCALES: Record<string, string>[] = [{}, { LANG: "" }, { LANG: "ja_JP.UTF-8" }, { LC_ALL: "C" }, { LC_CTYPE: "en_GB.UTF-8" }];

  it.each(LOCALES)("supplies a fallback locale only where nothing names one: %o", (locale) => {
    const named = ["LC_ALL", "LC_CTYPE", "LANG"].some((name) => (locale[name] ?? "") !== "");
    expect(inheritedPtyEnv({ PATH: "/usr/bin", ...locale }, "darwin", ":").LANG).toBe(named ? locale.LANG : "en_US.UTF-8");
    expect(inheritedPtyEnv({ PATH: "/usr/bin", ...locale }, "linux", ":").LANG).toBe(locale.LANG);
  });
});

// Codex round 8. The dequote added in round 7 is WINDOWS semantics — `windowsSearchDirectories`
// strips a wrapping pair of quotes before looking inside — and applying it platformlessly removed a
// POSIX PATH entry the search would have used, because on POSIX a quote is part of the name.
describe("quoting is a Windows idea, and the rule follows the search", () => {
  const QUOTED_RUN_SCRIPT = '"/x/node_modules/.bin"';
  const QUOTED_WINDOWS = '"C:\\p\\node_modules\\.bin"';

  it("drops a quoted run-script entry on Windows, where the search dequotes", () => {
    expect(isLauncherPathEntry(QUOTED_WINDOWS, "win32")).toBe(true);
    expect(isLauncherPathEntry(QUOTED_RUN_SCRIPT, "win32")).toBe(true);
  });

  // A directory really named `"/x/node_modules/.bin"`, quotes included, is a directory execvp will
  // search. Stripping it would lose a PATH entry the user has.
  it("keeps a quoted entry on POSIX, where a quote is part of the name", () => {
    expect(isLauncherPathEntry(QUOTED_RUN_SCRIPT, "linux")).toBe(false);
    expect(isLauncherPathEntry(QUOTED_RUN_SCRIPT, "darwin")).toBe(false);
  });

  it("is unaffected for an unquoted entry, on either platform", () => {
    ["win32", "linux"].forEach((platform) => {
      expect(isLauncherPathEntry("/x/node_modules/.bin", platform as NodeJS.Platform)).toBe(true);
      expect(isLauncherPathEntry("/usr/bin", platform as NodeJS.Platform)).toBe(false);
    });
  });

  it("carries the platform through sanitizePtyEnv", () => {
    const env = { PATH: ["/usr/bin", QUOTED_RUN_SCRIPT].join(":") };
    expect(sanitizePtyEnv(env, ":", "linux").PATH).toBe(["/usr/bin", QUOTED_RUN_SCRIPT].join(":"));
    expect(sanitizePtyEnv(env, ":", "win32").PATH).toBe("/usr/bin");
  });
});
