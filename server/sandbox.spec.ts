import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  rewriteLoopbackForDocker,
  sandboxContainerName,
  sandboxEnabled,
  buildDockerRunArgs,
  writeSandboxClaudeConfig,
  sandboxClaudeConfigPath,
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
    expect(args).toContain("/run/host-services/ssh-auth.sock:/ssh-agent");
    expect(args).toContain("SSH_AUTH_SOCK=/ssh-agent");
  });
});
