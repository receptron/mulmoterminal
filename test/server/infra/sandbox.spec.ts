import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  rewriteLoopbackForDocker,
  sandboxContainerName,
  sandboxEnabled,
  buildDockerRunArgs,
  writeSandboxClaudeConfig,
  sandboxClaudeConfigPath,
  sandboxCredentialsPath,
  cleanupSandbox,
  parseMountConfigNames,
  resolveSandboxAuthArgs,
  sandboxPlatformSupported,
  readExpiresAt,
  isTokenExpired,
  looksLikeClaudeResponse,
} from "../../../server/infra/sandbox";

describe("rewriteLoopbackForDocker", () => {
  it("rewrites localhost / 127.0.0.1 to host.docker.internal", () => {
    expect(rewriteLoopbackForDocker("http://localhost:34567/api/hook")).toBe("http://host.docker.internal:34567/api/hook");
    expect(rewriteLoopbackForDocker("http://127.0.0.1:34567/api/mcp/x")).toBe("http://host.docker.internal:34567/api/mcp/x");
    expect(rewriteLoopbackForDocker("https://localhost/x")).toBe("https://host.docker.internal/x");
  });
  it("leaves non-loopback hosts untouched", () => {
    expect(rewriteLoopbackForDocker("https://example.com:34567/x")).toBe("https://example.com:34567/x");
    expect(rewriteLoopbackForDocker("https://localhostfoo.com/x")).toBe("https://localhostfoo.com/x"); // lookahead guard
  });
});

describe("sandboxContainerName", () => {
  it("prefixes the session id", () => {
    expect(sandboxContainerName("abc-123")).toBe("mulmoterminal-abc-123");
  });
});

describe("sandboxEnabled", () => {
  const prev = process.env.MULMOTERMINAL_SANDBOX;
  afterEach(() => {
    if (prev === undefined) delete process.env.MULMOTERMINAL_SANDBOX;
    else process.env.MULMOTERMINAL_SANDBOX = prev;
  });
  it("is off by default, on for 1/true", () => {
    delete process.env.MULMOTERMINAL_SANDBOX;
    expect(sandboxEnabled()).toBe(false);
    process.env.MULMOTERMINAL_SANDBOX = "1";
    expect(sandboxEnabled()).toBe(true);
    process.env.MULMOTERMINAL_SANDBOX = "true";
    expect(sandboxEnabled()).toBe(true);
    process.env.MULMOTERMINAL_SANDBOX = "0";
    expect(sandboxEnabled()).toBe(false);
  });
});

// Locks the gate the module comment describes: Linux is off until the spawn maps uids
// (bind-mounted files would land as uid 1000), Windows is off because `-v <cwd>:<cwd>`
// isn't a valid Linux container path. Enabling either needs that work done deliberately,
// so it should break a test rather than pass silently.
describe("sandboxPlatformSupported", () => {
  it("is macOS only", () => {
    expect(sandboxPlatformSupported("darwin")).toBe(true);
    for (const platform of ["win32", "linux", "freebsd", "aix"] as const) {
      expect(sandboxPlatformSupported(platform), platform).toBe(false);
    }
  });

  it("reads the running platform when none is given", () => {
    expect(sandboxPlatformSupported()).toBe(sandboxPlatformSupported(process.platform));
  });
});

describe("buildDockerRunArgs", () => {
  const args = buildDockerRunArgs("sid1", ["--session-id", "sid1", "--mcp-config", "/x.json"], "/Users/me/proj", "/cfg/x.json");

  it("runs the sandbox image with claude + its args after the image", () => {
    const img = args.indexOf("mulmoterminal-sandbox");
    expect(img).toBeGreaterThan(0);
    expect(args.slice(img + 1)).toEqual(["claude", "--session-id", "sid1", "--mcp-config", "/x.json"]);
  });
  it("is an --rm -it named container with host-gateway, HOME, and DISABLE_AUTOUPDATER", () => {
    expect(args.slice(0, 3)).toEqual(["run", "--rm", "-it"]);
    expect(args[args.indexOf("--name") + 1]).toBe("mulmoterminal-sid1");
    expect(args).toContain("host.docker.internal:host-gateway");
    expect(args).toContain("HOME=/home/node");
    expect(args).toContain("DISABLE_AUTOUPDATER=1");
  });
  it("mounts cwd at its SAME path + ~/.claude (auth) + the generated config, and -w cwd", () => {
    expect(args).toContain("/Users/me/proj:/Users/me/proj");
    expect(args).toContain(`${path.join(os.homedir(), ".claude")}:/home/node/.claude`);
    expect(args).toContain("/cfg/x.json:/home/node/.claude.json"); // the generated config, NOT host ~/.claude.json
    expect(args[args.indexOf("-w") + 1]).toBe("/Users/me/proj");
  });
});

describe("sandbox image shipping", () => {
  // Regression: the auto-build (ensureSandboxImage) resolves <pkg>/Dockerfile.sandbox, so
  // it MUST be in the npm package `files` — else installs can't build the image and the
  // sandbox fails with a cryptic `docker run` error.
  it("ships Dockerfile.sandbox in the package files", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    expect(pkg.files).toContain("Dockerfile.sandbox");
  });
});

describe("sandboxCredentialsPath", () => {
  it("names a per-session creds file under the sandbox dir", () => {
    expect(sandboxCredentialsPath("abc-123")).toBe(path.join(os.homedir(), ".mulmoterminal", "sandbox", "creds-abc-123.json"));
  });
});

describe("buildDockerRunArgs credential overlay", () => {
  it("overlays the creds file writable, AFTER the ~/.claude dir mount so it shadows the stale one", () => {
    const args = buildDockerRunArgs("sid1", ["--x"], "/Users/me/proj", "/cfg/x.json", "/creds/y.json");
    // NOT :ro — the container must be able to persist a token it refreshes mid-session.
    // The target is our throwaway per-session file, so the host Keychain/file stay untouched.
    expect(args).toContain("/creds/y.json:/home/node/.claude/.credentials.json");
    expect(args.some((a) => a === "/creds/y.json:/home/node/.claude/.credentials.json:ro")).toBe(false);
    const dirMount = args.indexOf(`${path.join(os.homedir(), ".claude")}:/home/node/.claude`);
    const overlay = args.indexOf("/creds/y.json:/home/node/.claude/.credentials.json");
    expect(dirMount).toBeGreaterThan(-1);
    expect(overlay).toBeGreaterThan(dirMount); // a deeper target only shadows when mounted after its parent
  });
  it("adds NO credential overlay when credentialsPath is omitted/null", () => {
    const args = buildDockerRunArgs("sid1", ["--x"], "/Users/me/proj", "/cfg/x.json");
    expect(args.some((a) => a.includes("/.claude/.credentials.json"))).toBe(false);
  });
});

// The Keychain blob's real shape, from `security find-generic-password -s "Claude Code-credentials" -w`.
const credBlob = (expiresAt: number | string | null): string =>
  JSON.stringify({ claudeAiOauth: { accessToken: "a", refreshToken: "r", ...(expiresAt === null ? {} : { expiresAt }) } });

describe("readExpiresAt", () => {
  it("pulls claudeAiOauth.expiresAt as a string", () => {
    expect(readExpiresAt(credBlob(1784602611420))).toBe("1784602611420");
    expect(readExpiresAt(credBlob("2026-07-20T00:00:00Z"))).toBe("2026-07-20T00:00:00Z");
  });
  it("is null when the JSON is unparseable, not an object, or carries no expiry", () => {
    expect(readExpiresAt("not json")).toBeNull();
    expect(readExpiresAt("42")).toBeNull();
    expect(readExpiresAt(JSON.stringify({ somethingElse: 1 }))).toBeNull();
    expect(readExpiresAt(credBlob(null))).toBeNull();
  });
});

describe("isTokenExpired", () => {
  const HOUR_MS = 3_600_000;
  it("is false for a token comfortably in the future", () => {
    expect(isTokenExpired(credBlob(Date.now() + HOUR_MS))).toBe(false);
  });
  it("is true for a token in the past", () => {
    expect(isTokenExpired(credBlob(Date.now() - HOUR_MS))).toBe(true);
  });
  it("applies the 60s safety margin (a token expiring in 30s counts as expired)", () => {
    expect(isTokenExpired(credBlob(Date.now() + 30_000))).toBe(true);
    expect(isTokenExpired(credBlob(Date.now() + 120_000))).toBe(false);
  });
  it("treats unparseable / missing expiry as expired (err toward refreshing)", () => {
    expect(isTokenExpired("not json")).toBe(true);
    expect(isTokenExpired(credBlob(null))).toBe(true);
    expect(isTokenExpired(credBlob("not-a-date"))).toBe(true);
  });
  it("accepts an ISO-string expiry too", () => {
    expect(isTokenExpired(credBlob(new Date(Date.now() + HOUR_MS).toISOString()))).toBe(false);
    expect(isTokenExpired(credBlob(new Date(Date.now() - HOUR_MS).toISOString()))).toBe(true);
  });
});

describe("looksLikeClaudeResponse", () => {
  it("accepts a conversational reply of real length", () => {
    expect(looksLikeClaudeResponse("Hello! How can I help you today?")).toBe(true);
    expect(looksLikeClaudeResponse("Hi there — I can do that.")).toBe(true);
  });
  it("rejects error banners and too-short output", () => {
    expect(looksLikeClaudeResponse("Please log in to continue")).toBe(false);
    expect(looksLikeClaudeResponse("Invalid credentials")).toBe(false);
    expect(looksLikeClaudeResponse("Hi")).toBe(false); // matches the word but too short
    expect(looksLikeClaudeResponse("")).toBe(false);
  });
});

describe("cleanupSandbox", () => {
  // cleanupSandbox runs `docker rm -f` first; on the Windows CI runner the docker CLI
  // is present but its daemon is slow to answer, pushing this past vitest's 5s default.
  const DOCKER_CALL_TIMEOUT_MS = 30_000;
  it(
    "unlinks the per-session credential file (no leaked token after reap)",
    () => {
      const sid = "cleanup-creds-1";
      const file = sandboxCredentialsPath(sid);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, "dummy");
      expect(existsSync(file)).toBe(true);
      cleanupSandbox(sid);
      expect(existsSync(file)).toBe(false);
    },
    DOCKER_CALL_TIMEOUT_MS,
  );
});

describe("writeSandboxClaudeConfig", () => {
  const sid = "cfg-test-1";
  afterEach(() => rmSync(sandboxClaudeConfigPath(sid), { force: true }));
  it("writes onboarding-done + the cwd pre-trusted (no host ~/.claude.json needed)", () => {
    const file = writeSandboxClaudeConfig(sid, "/Users/me/proj");
    const cfg = JSON.parse(readFileSync(file, "utf8"));
    expect(cfg.hasCompletedOnboarding).toBe(true);
    expect(cfg.projects["/Users/me/proj"]).toMatchObject({ hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true });
    expect(cfg.installMethod).toBeUndefined(); // no `native` install → no "missing or broken" warning
  });
});

describe("parseMountConfigNames (credentials allowlist)", () => {
  it("keeps only the known names (gh, gitconfig), drops unknown/blank", () => {
    expect(parseMountConfigNames("gh, gitconfig")).toEqual(["gh", "gitconfig"]);
    expect(parseMountConfigNames("gh,evil,../etc,gitconfig")).toEqual(["gh", "gitconfig"]);
    expect(parseMountConfigNames("")).toEqual([]);
    expect(parseMountConfigNames(undefined)).toEqual([]);
  });
  it("collapses duplicate names (no duplicate -v mount → no docker error)", () => {
    expect(parseMountConfigNames("gh,gh,gitconfig,gh")).toEqual(["gh", "gitconfig"]);
  });
  it("rejects prototype-chain keys (own-properties only)", () => {
    expect(parseMountConfigNames("__proto__,constructor,toString,hasOwnProperty,gh")).toEqual(["gh"]);
  });
});

describe("resolveSandboxAuthArgs (opt-in, env-gated)", () => {
  const prevConfigs = process.env.SANDBOX_MOUNT_CONFIGS;
  const prevSsh = process.env.SANDBOX_SSH_AGENT_FORWARD;
  afterEach(() => {
    if (prevConfigs === undefined) delete process.env.SANDBOX_MOUNT_CONFIGS;
    else process.env.SANDBOX_MOUNT_CONFIGS = prevConfigs;
    if (prevSsh === undefined) delete process.env.SANDBOX_SSH_AGENT_FORWARD;
    else process.env.SANDBOX_SSH_AGENT_FORWARD = prevSsh;
  });
  it("is empty when neither env is set (no impact by default)", () => {
    delete process.env.SANDBOX_MOUNT_CONFIGS;
    delete process.env.SANDBOX_SSH_AGENT_FORWARD;
    expect(resolveSandboxAuthArgs()).toEqual([]);
  });
  it("forwards the ssh-agent socket read-only when SANDBOX_SSH_AGENT_FORWARD=1", () => {
    delete process.env.SANDBOX_MOUNT_CONFIGS;
    process.env.SANDBOX_SSH_AGENT_FORWARD = "1";
    const args = resolveSandboxAuthArgs();
    expect(args).toContain("/run/host-services/ssh-auth.sock:/ssh-agent:ro"); // read-only: never mutate the host agent socket
    expect(args).toContain("SSH_AUTH_SOCK=/ssh-agent");
    // Every -v this opt-in auth function emits must be read-only.
    args.forEach((a, i) => {
      if (args[i - 1] === "-v") expect(a.endsWith(":ro")).toBe(true);
    });
  });
});
