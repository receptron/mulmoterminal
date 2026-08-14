// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isLauncherEnvVar, isPathVar, pathFromEnv, sanitizePathEntries, sanitizePtyEnv, withFallbackLocale } from "../../../server/infra/pty-env";

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

describe("withFallbackLocale", () => {
  // The bug this exists for: an embedder launched from the macOS GUI (a .app, a LaunchAgent)
  // inherits launchd's environment, which names NO locale at all. Our tmux client then runs
  // under C/POSIX, where tmux writes ONE UNDERSCORE PER CELL for any character it cannot map —
  // so Claude Code's block-element banner logo (▐▛███▜▌) arrived as _______.
  it("names a UTF-8 locale when the environment names none", () => {
    expect(withFallbackLocale({ HOME: "/Users/u" }, "darwin").LANG).toBe("en_US.UTF-8");
  });

  it("treats an empty value as naming no locale (a login shell can export a bare LANG=)", () => {
    expect(withFallbackLocale({ LANG: "" }, "darwin").LANG).toBe("en_US.UTF-8");
    expect(withFallbackLocale({ LC_ALL: "", LC_CTYPE: "", LANG: "" }, "darwin").LANG).toBe("en_US.UTF-8");
  });

  // LC_ALL and LC_CTYPE both outrank LANG, so writing one could not override them anyway.
  it.each([
    ["LC_ALL", { LC_ALL: "en_US.UTF-8", LANG: "" }],
    ["LC_CTYPE", { LC_CTYPE: "en_US.UTF-8" }],
    ["LANG", { LANG: "ja_JP.UTF-8" }],
  ])("leaves the environment alone when %s already names a locale", (_case, env) => {
    expect(withFallbackLocale(env, "darwin")).toEqual(env);
  });

  // Windows has no such convention and no tmux; introducing a variable it never had is its
  // own bug waiting to be reported (git-bash reads LANG).
  it("adds nothing on Windows", () => {
    expect(withFallbackLocale({ HOME: "C:\\Users\\u" }, "win32")).toEqual({ HOME: "C:\\Users\\u" });
  });

  it("returns a copy without mutating the input", () => {
    const env: NodeJS.ProcessEnv = { HOME: "/Users/u" };
    const out = withFallbackLocale(env, "linux");
    expect(env.LANG).toBeUndefined();
    expect(out).not.toBe(env);
    expect(out.HOME).toBe("/Users/u");
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
