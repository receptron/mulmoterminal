import { describe, it, expect } from "vitest";
import { isLauncherEnvVar, isPathVar, sanitizePathEntries, sanitizePtyEnv } from "../../../server/infra/pty-env";

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
