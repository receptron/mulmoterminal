import { describe, it, expect } from "vitest";
import { buildSandboxDockerArgs } from "./sandbox.js";

// Pull the value following each occurrence of `flag` in argv (e.g. every `-v`).
function valuesFor(argv: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === flag) out.push(argv[i + 1]);
  return out;
}

const base = {
  workspacePath: "/Users/dev/work",
  claudeArgs: ["--session-id", "abc", "--mcp-config", "{}"],
  uid: 501,
  gid: 20,
  home: "/Users/dev",
  env: {} as NodeJS.ProcessEnv,
};

describe("buildSandboxDockerArgs", () => {
  it("starts with `run --rm -i -t` and ends with `claude <args>`", () => {
    const argv = buildSandboxDockerArgs({ ...base, platform: "darwin" });
    expect(argv.slice(0, 4)).toEqual(["run", "--rm", "-i", "-t"]);
    const claudeIdx = argv.indexOf("claude");
    expect(claudeIdx).toBeGreaterThan(0);
    expect(argv.slice(claudeIdx)).toEqual(["claude", "--session-id", "abc", "--mcp-config", "{}"]);
    expect(argv[claudeIdx - 1]).toBe("mulmoterminal-sandbox");
  });

  it("runs as the host uid:gid", () => {
    const argv = buildSandboxDockerArgs({ ...base, platform: "darwin" });
    expect(valuesFor(argv, "--user")).toEqual(["501:20"]);
  });

  it("mounts the workspace at its identical host path and selects it with -w", () => {
    const argv = buildSandboxDockerArgs({ ...base, platform: "darwin" });
    expect(valuesFor(argv, "-v")).toContain("/Users/dev/work:/Users/dev/work");
    expect(valuesFor(argv, "-w")).toEqual(["/Users/dev/work"]);
  });

  it("mounts the host's ~/.claude and ~/.claude.json into the container HOME", () => {
    const argv = buildSandboxDockerArgs({ ...base, platform: "darwin" });
    const mounts = valuesFor(argv, "-v");
    expect(mounts).toContain("/Users/dev/.claude:/home/node/.claude");
    expect(mounts).toContain("/Users/dev/.claude.json:/home/node/.claude.json");
    expect(valuesFor(argv, "-e")).toContain("HOME=/home/node");
  });

  it("adds host.docker.internal mapping only on Linux", () => {
    const linux = buildSandboxDockerArgs({ ...base, platform: "linux" });
    expect(valuesFor(linux, "--add-host")).toEqual(["host.docker.internal:host-gateway"]);
    const mac = buildSandboxDockerArgs({ ...base, platform: "darwin" });
    expect(valuesFor(mac, "--add-host")).toEqual([]);
  });

  it("forwards only allowlisted credential env vars that are set", () => {
    const argv = buildSandboxDockerArgs({
      ...base,
      platform: "darwin",
      env: { ANTHROPIC_API_KEY: "sk-ant", GEMINI_API_KEY: "g-key", SECRET_UNRELATED: "nope" },
    });
    const envs = valuesFor(argv, "-e");
    expect(envs).toContain("ANTHROPIC_API_KEY=sk-ant");
    expect(envs).toContain("GEMINI_API_KEY=g-key");
    expect(envs.some((e) => e.startsWith("SECRET_UNRELATED"))).toBe(false);
  });
});
