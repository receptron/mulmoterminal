// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  isLauncherEnvVar,
  isLauncherPathEntry,
  isPathVar,
  pathFromEnv,
  sanitizePathEntries,
  sanitizePtyEnv,
  withFallbackLocale,
} from "../../../../server/infra/process/pty-env";

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
  // Volta marks the node it launches; a shim that sees it skips Volta's own version choice, so
  // `yarn` fails with "Node is not available" in a cell under `volta run` (#3233).
  it("flags the marker `volta run` sets on the process it launches", () => {
    expect(isLauncherEnvVar("_VOLTA_TOOL_RECURSION")).toBe(true);
  });

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

  // `volta run` prepends the image dir of the tool it picked. A cell that keeps it runs that `node` /
  // `npm` directly, past the shim and so past a project's `volta` pin (#3233) — but the dir goes only
  // while Volta's own shim dir is on the PATH to find a `node`.
  describe("Volta's image dirs", () => {
    const VOLTA = "/home/u/.volta";

    it("does not take a relative entry for the absolute one beside the shim dir", () => {
      const relative = "volta/tools/image/node/24.21.0/bin";
      expect(sanitizePathEntries([relative, "/volta/bin"].join(":"), ":", "linux")).toBe([relative, "/volta/bin"].join(":"));
      expect(sanitizePathEntries(["/volta/tools/image/node/24.21.0/bin", "volta/bin"].join(":"), ":", "linux")).toBe(
        ["/volta/tools/image/node/24.21.0/bin", "volta/bin"].join(":"),
      );
    });

    it("treats a backslash as part of a name on POSIX, not as a separator", () => {
      const literal = "/home/u/tools\\image\\node\\24.21.0";
      expect(sanitizePathEntries([literal, "/home/u/bin"].join(":"), ":", "linux")).toBe([literal, "/home/u/bin"].join(":"));
    });

    it("drops every tool's image dir beside Volta's shim dir", () => {
      const dirty = [
        `${VOLTA}/tools/image/node/24.21.0/bin`,
        `${VOLTA}/tools/image/npm/12.2.1/bin`,
        `${VOLTA}/tools/image/yarn/1.22.22/bin`,
        `${VOLTA}/tools/image/pnpm/10.0.0/bin`,
        `${VOLTA}/bin`,
        "/usr/bin",
      ];
      expect(sanitizePathEntries(dirty.join(":"), ":", "linux")).toBe([`${VOLTA}/bin`, "/usr/bin"].join(":"));
    });

    it("keeps the image dir when Volta's shim dir is not on the PATH", () => {
      const p = [`${VOLTA}/tools/image/node/24.21.0/bin`, "/usr/bin"].join(":");
      expect(sanitizePathEntries(p, ":", "linux")).toBe(p);
    });

    it("keeps the image dir when the shim dir on the PATH belongs to another Volta", () => {
      const p = [`${VOLTA}/tools/image/node/24.21.0/bin`, "/opt/volta/bin"].join(":");
      expect(sanitizePathEntries(p, ":", "linux")).toBe(p);
    });

    it("keeps a dir that only looks like one", () => {
      const p = [`${VOLTA}/tools/image/python/3.12/bin`, `${VOLTA}/tools/image/node/24.21.0/lib`, `${VOLTA}/bin`].join(":");
      expect(sanitizePathEntries(p, ":", "linux")).toBe(p);
    });

    it("drops a Windows image dir, which has no bin, matching case-insensitively", () => {
      const dirty = ["C:\\Users\\u\\AppData\\Local\\Volta\\tools\\image\\node\\24.21.0", "c:\\users\\u\\appdata\\local\\volta\\bin", "C:\\Windows"];
      expect(sanitizePathEntries(dirty.join(";"), ";", "win32")).toBe(dirty.slice(1).join(";"));
    });
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

  it("drops Volta's recursion marker but keeps the user's other VOLTA_ settings (#3233)", () => {
    const out = sanitizePtyEnv({ _VOLTA_TOOL_RECURSION: "1", VOLTA_HOME: "/home/u/.volta", VOLTA_FEATURE_PNPM: "1" }, ":");
    expect(out._VOLTA_TOOL_RECURSION).toBeUndefined();
    expect(out.VOLTA_HOME).toBe("/home/u/.volta");
    expect(out.VOLTA_FEATURE_PNPM).toBe("1");
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

// A Windows PATH entry may be written with quotes — `"C:\Program Files\tools"` — and
// `windowsSearchDirectories` strips the pair before looking inside. `isLauncherPathEntry` compared
// the QUOTED spelling, so `"…\node_modules\.bin"` survived the sanitiser and was then searched
// anyway: the directory this function exists to remove, kept by its punctuation.
//
// BOTH platforms are named explicitly rather than left to the runner, and that is not thoroughness
// for its own sake — the gap hid because quoting is a Windows idea and every test ran on POSIX,
// where the answer is the same either way.
describe("a quoted PATH entry, where the search dequotes and where it does not", () => {
  const QUOTED_RUN_SCRIPT = '"C:\\p\\node_modules\\.bin"';
  const QUOTED_USER_DIR = '"C:\\Program Files\\tools"';

  it("is removed on Windows, because the search would have found it", () => {
    expect(isLauncherPathEntry(QUOTED_RUN_SCRIPT, "win32")).toBe(true);
    expect(sanitizePathEntries([QUOTED_RUN_SCRIPT, "C:\\Windows"].join(";"), ";", "win32")).toBe("C:\\Windows");
  });

  // On POSIX nothing dequotes, so a directory may legally BE named with them — stripping the entry
  // there would drop a PATH the search would have used.
  it("is kept on POSIX, because there a quote is part of the name", () => {
    expect(isLauncherPathEntry('"/x/node_modules/.bin"', "linux")).toBe(false);
    expect(sanitizePathEntries(['"/x/node_modules/.bin"', "/usr/bin"].join(":"), ":", "linux")).toBe('"/x/node_modules/.bin":/usr/bin');
  });

  it("leaves a quoted directory of the user's alone on either platform", () => {
    expect(isLauncherPathEntry(QUOTED_USER_DIR, "win32")).toBe(false);
    expect(isLauncherPathEntry(QUOTED_USER_DIR, "linux")).toBe(false);
  });

  // Unquoted entries answer exactly as before, which is what says this changed only the case it
  // was meant to.
  it.each(["win32", "linux"] as NodeJS.Platform[])("is unchanged for an unquoted entry on %s", (platform) => {
    expect(isLauncherPathEntry("/x/node_modules/.bin", platform)).toBe(true);
    expect(isLauncherPathEntry("C:\\p\\node_modules\\.bin", platform)).toBe(true);
    expect(isLauncherPathEntry("/usr/bin", platform)).toBe(false);
  });

  // Malformed quoting must not be mistaken for a pair.
  it.each(['"unterminated', 'unterminated"', '""', '"'])("does not treat %p as a quoted directory", (entry) => {
    expect(isLauncherPathEntry(entry, "win32")).toBe(false);
  });

  it("carries the platform through sanitizePtyEnv, including the Windows Path spelling", () => {
    const env = { Path: [QUOTED_RUN_SCRIPT, "C:\\Windows"].join(";") };
    expect(sanitizePtyEnv(env, ";", "win32").Path).toBe("C:\\Windows");
    expect(sanitizePtyEnv(env, ";", "linux").Path).toBe([QUOTED_RUN_SCRIPT, "C:\\Windows"].join(";"));
  });
});
