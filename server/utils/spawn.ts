import { spawn as nodeSpawn } from "node:child_process";
import type { SpawnOptions } from "node:child_process";

interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Unified spawn wrapper to reduce duplication across git utilities
export const spawnGit = async (
  cwd: string | undefined,
  args: string[],
): Promise<SpawnResult> => {
  const gitArgs = cwd ? ["-C", cwd, ...args] : args;
  return spawnCommand("git", gitArgs, { stdio: ["ignore", "pipe", "pipe"] });
};

export const spawnCommand = async (
  cmd: string,
  args: string[],
  opts?: SpawnOptions,
): Promise<SpawnResult> => {
  return new Promise((resolve) => {
    const child = nodeSpawn(cmd, args, opts);
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
};
