// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const spawnPty = vi.hoisted(() => vi.fn());

vi.mock("../../session/pty/pty-spawn.js", () => ({ spawnPty }));
vi.mock("../../infra/process/has-binary.js", () => ({ hasBinary: () => true }));
// A state directory of this spec's own, so the probe folder the service makes is never the machine's.
vi.mock("../../config/env.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config/env.js")>()),
  MULMOTERMINAL_HOME: mkdtempSync(path.join(tmpdir(), "mt-ratelimit-state-")),
}));
vi.mock("./rate-limit-persist.js", () => ({
  rateLimitCacheFile: () => "/nonexistent/rate-limits.json",
  readRateLimitCache: () => ({}),
  createRateLimitCacheWriter: () => () => {},
}));
// Calls the spawn closure the way the real probe does — with the cwd the service chose — so what the
// service hands to spawnPty is observable.
vi.mock("./rate-limit-probe.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./rate-limit-probe.js")>();
  return { ...actual, startRateLimitProbe: vi.fn((deps: Parameters<typeof actual.startRateLimitProbe>[0]) => (deps.spawn(["--probe"], deps.cwd), () => {})) };
});

// The default login's Claude Code config is looked up through CLAUDE_CONFIG_DIR at call time, and
// the service writes the probe folder's trust into it (#3206) — so it must never be the machine's.
const DEFAULT_LOGIN_DIR = mkdtempSync(path.join(tmpdir(), "mt-ratelimit-login-"));
vi.stubEnv("CLAUDE_CONFIG_DIR", DEFAULT_LOGIN_DIR);

const { createRateLimitService, startHomeProbe } = await import("./rate-limit-service.js");
const { MULMOTERMINAL_HOME: STATE_DIR } = await import("../../config/env.js");
const { startRateLimitProbe } = await import("./rate-limit-probe.js");
const realProbe = await vi.importActual<typeof import("./rate-limit-probe.js")>("./rate-limit-probe.js");

const PIN = { CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "1" };
const PROBE_CWD = path.join(STATE_DIR, "probe");

beforeEach(() => {
  spawnPty.mockReset();
  rmSync(PROBE_CWD, { recursive: true, force: true });
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(STATE_DIR, { recursive: true, force: true });
  rmSync(DEFAULT_LOGIN_DIR, { recursive: true, force: true });
});

describe("the usage probes pin the classic renderer (#2936)", () => {
  it("the default login's probe passes the pin to spawnPty", () => {
    createRateLimitService().startProbe();

    expect(spawnPty).toHaveBeenCalledTimes(1);
    expect(spawnPty.mock.calls[0].slice(1)).toEqual([["--probe"], PROBE_CWD, [], PIN]);
  });

  it("an account's probe keeps its login variable, its unset list, and the pin", () => {
    startHomeProbe("/acct", "key", () => {}, ["CLAUDE_CODE_OAUTH_TOKEN"], { CLAUDE_CONFIG_DIR: "/acct" });

    expect(spawnPty).toHaveBeenCalledTimes(1);
    expect(spawnPty.mock.calls[0].slice(1)).toEqual([["--probe"], PROBE_CWD, ["CLAUDE_CODE_OAUTH_TOKEN"], { CLAUDE_CONFIG_DIR: "/acct", ...PIN }]);
  });
});

// The probe used to run in the workspace, which is wherever the launcher was started — and started
// in the home directory, that is the one folder Claude Code never saves trust for, so every probe met
// the dialog and accepting it changed nothing.
describe("the usage probes run in MulmoTerminal's own folder (#3200)", () => {
  it("starts every kind of probe in the probe folder, not the workspace, and makes the folder first", () => {
    expect(existsSync(PROBE_CWD)).toBe(false);
    createRateLimitService().startProbe();
    startHomeProbe("/acct", "key", () => {}, [], { CLAUDE_CONFIG_DIR: "/acct" });

    expect(spawnPty.mock.calls.map((call) => call[2])).toEqual([PROBE_CWD, PROBE_CWD]);
    expect(existsSync(PROBE_CWD)).toBe(true);
  });

  // The gauge names the folder in its trust-prompt note, so the route has to be told which it is.
  it("tells the routes the folder, so the gauge can name it", () => {
    expect(createRateLimitService().probeCwd).toBe(PROBE_CWD);
  });

  // Nobody runs `claude` in the probe folder by hand, so without this every login would need a person
  // to accept the trust dialog there once before the gauge showed anything (#3206). The answer goes
  // in the config of the login the probe runs on, keyed by the folder's real path.
  const trustedIn = (configFile: string): unknown => {
    const config: unknown = JSON.parse(readFileSync(configFile, "utf8"));
    const projects = config !== null && typeof config === "object" && "projects" in config ? config.projects : undefined;
    const entry = projects !== null && typeof projects === "object" ? Reflect.get(projects, realpathSync.native(PROBE_CWD)) : undefined;
    return entry !== null && typeof entry === "object" ? Reflect.get(entry, "hasTrustDialogAccepted") : undefined;
  };

  it("marks the folder trusted in the default login's config before the spawn", () => {
    const configFile = path.join(DEFAULT_LOGIN_DIR, ".claude.json");
    writeFileSync(configFile, JSON.stringify({ numStartups: 3, projects: { "/elsewhere": { hasTrustDialogAccepted: true } } }, null, 2));

    createRateLimitService().startProbe();

    expect(trustedIn(configFile)).toBe(true);
    expect(JSON.parse(readFileSync(configFile, "utf8"))).toMatchObject({ numStartups: 3, projects: { "/elsewhere": { hasTrustDialogAccepted: true } } });
    expect(spawnPty).toHaveBeenCalledTimes(1);
  });

  it("writes an account's trust into that account's own config, not the default login's", () => {
    const account = mkdtempSync(path.join(tmpdir(), "mt-ratelimit-acct-"));
    const accountFile = path.join(account, ".claude.json");
    writeFileSync(accountFile, "{}");
    const defaultFile = path.join(DEFAULT_LOGIN_DIR, ".claude.json");
    const defaultBefore = existsSync(defaultFile) ? readFileSync(defaultFile, "utf8") : null;

    startHomeProbe(account, "key", () => {}, [], { CLAUDE_CONFIG_DIR: account });

    expect(trustedIn(accountFile)).toBe(true);
    expect(existsSync(defaultFile) ? readFileSync(defaultFile, "utf8") : null).toBe(defaultBefore);
    rmSync(account, { recursive: true, force: true });
  });

  // Claude Code's own save can land on top of the write (own-folder-trust.ts). The service must not take
  // its write as the last word: the next probe reads again, and writes again when the key is gone.
  it("writes the trust again when a later read no longer finds it", () => {
    const account = mkdtempSync(path.join(tmpdir(), "mt-ratelimit-acct-"));
    const accountFile = path.join(account, ".claude.json");
    writeFileSync(accountFile, "{}");
    startHomeProbe(account, "key", () => {}, [], { CLAUDE_CONFIG_DIR: account });
    expect(trustedIn(accountFile)).toBe(true);

    writeFileSync(accountFile, JSON.stringify({ projects: {} }));
    startHomeProbe(account, "key", () => {}, [], { CLAUDE_CONFIG_DIR: account });

    expect(trustedIn(accountFile)).toBe(true);
    rmSync(account, { recursive: true, force: true });
  });

  // A rotation token's probe runs on the default login with its own credential (#2919); its trust
  // answers are the default login's, so that is the file its probe marks.
  it("marks the default login's config for a rotation token's probe", () => {
    const configFile = path.join(DEFAULT_LOGIN_DIR, ".claude.json");
    writeFileSync(configFile, JSON.stringify({ projects: {} }));

    startHomeProbe(DEFAULT_LOGIN_DIR, "key", () => {}, ["CLAUDE_CODE_OAUTH_TOKEN"], {}, { CLAUDE_CODE_OAUTH_TOKEN: "secret" });

    expect(trustedIn(configFile)).toBe(true);
  });

  // A probe folder somebody replaced with a link points at a directory that is not ours; trust for
  // it would land on that directory. The probe still runs there and its stall names the prompt.
  it.skipIf(process.platform === "win32")("writes no trust when the probe folder is a link, and still spawns", () => {
    const account = mkdtempSync(path.join(tmpdir(), "mt-ratelimit-acct-"));
    const accountFile = path.join(account, ".claude.json");
    writeFileSync(accountFile, "{}");
    const elsewhere = mkdtempSync(path.join(tmpdir(), "mt-ratelimit-elsewhere-"));
    symlinkSync(elsewhere, PROBE_CWD);

    startHomeProbe(account, "key", () => {}, [], { CLAUDE_CONFIG_DIR: account });

    expect(spawnPty).toHaveBeenCalledTimes(1);
    expect(readFileSync(accountFile, "utf8")).toBe("{}");
    rmSync(account, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  });

  // A login that has never run claude has no config yet. The probe still runs — it is the stall
  // that then names the prompt — and no config is invented for it.
  it("still spawns when the login has no config file, and creates none", () => {
    const account = mkdtempSync(path.join(tmpdir(), "mt-ratelimit-acct-"));

    startHomeProbe(account, "key", () => {}, [], { CLAUDE_CONFIG_DIR: account });

    expect(spawnPty).toHaveBeenCalledTimes(1);
    expect(existsSync(path.join(account, ".claude.json"))).toBe(false);
    rmSync(account, { recursive: true, force: true });
  });

  // The folder is made inside the spawn, after the caller has marked a probe in flight. A folder that
  // cannot be made must therefore arrive as the ordinary "nothing came back" — through the real
  // startRateLimitProbe — or the flag stays set and the gauge stops refreshing for the life of the
  // process.
  it("settles the probe as silence when the folder cannot be made, leaving nothing in flight", () => {
    writeFileSync(PROBE_CWD, "a file where the folder should be");
    vi.mocked(startRateLimitProbe).mockImplementationOnce(realProbe.startRateLimitProbe);
    const service = createRateLimitService();
    service.store.setProbeInFlight(true);

    service.startProbe();

    expect(spawnPty).not.toHaveBeenCalled();
    expect(service.store.isProbing()).toBe(false);
    expect(service.store.probeState()).toMatchObject({ kind: "no-report", stall: "unknown" });
  });
});
