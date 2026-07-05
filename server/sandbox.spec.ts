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
} from "./sandbox";

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

describe("sandboxCredentialsPath", () => {
  it("names a per-session creds file under the sandbox dir", () => {
    expect(sandboxCredentialsPath("abc-123")).toBe(path.join(os.homedir(), ".mulmoterminal", "sandbox", "creds-abc-123.json"));
  });
});

describe("buildDockerRunArgs credential overlay", () => {
  it("overlays the creds file read-only, AFTER the ~/.claude dir mount so it shadows the stale one", () => {
    const args = buildDockerRunArgs("sid1", ["--x"], "/Users/me/proj", "/cfg/x.json", "/creds/y.json");
    expect(args).toContain("/creds/y.json:/home/node/.claude/.credentials.json:ro"); // read-only, host file untouched
    const dirMount = args.indexOf(`${path.join(os.homedir(), ".claude")}:/home/node/.claude`);
    const overlay = args.indexOf("/creds/y.json:/home/node/.claude/.credentials.json:ro");
    expect(dirMount).toBeGreaterThan(-1);
    expect(overlay).toBeGreaterThan(dirMount); // a deeper target only shadows when mounted after its parent
  });
  it("adds NO credential overlay when credentialsPath is omitted/null", () => {
    const args = buildDockerRunArgs("sid1", ["--x"], "/Users/me/proj", "/cfg/x.json");
    expect(args.some((a) => a.includes("/.claude/.credentials.json"))).toBe(false);
  });
});

describe("cleanupSandbox", () => {
  it("unlinks the per-session credential file (no leaked token after reap)", () => {
    const sid = "cleanup-creds-1";
    const file = sandboxCredentialsPath(sid);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "dummy");
    expect(existsSync(file)).toBe(true);
    cleanupSandbox(sid);
    expect(existsSync(file)).toBe(false);
  });
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
    expect(args).toContain("/run/host-services/ssh-auth.sock:/ssh-agent:ro"); // read-only, like every credential mount
    expect(args).toContain("SSH_AUTH_SOCK=/ssh-agent");
    // Every -v this function emits must be read-only.
    args.forEach((a, i) => {
      if (args[i - 1] === "-v") expect(a.endsWith(":ro")).toBe(true);
    });
  });
});
