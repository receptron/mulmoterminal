// CI check for the sandbox image build path. Exercises the REAL ensureSandboxImage()
// against a real Docker daemon — the one part of the sandbox that unit tests can't reach,
// and the one most likely to rot silently: Dockerfile.sandbox pins nothing, so a base-image
// or apt/npm change breaks it without any code change.
//
// The contract under test is the sha256-label cache: build when missing or when the
// Dockerfile changed, no-op otherwise. Run from the repo root with tsx.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureSandboxImage, sandboxImageExists } from "../server/infra/sandbox.js";

// Same override sandbox.ts honours, so a local run can point at a throwaway tag instead
// of clobbering the developer's real image.
const IMAGE = process.env.MULMOTERMINAL_SANDBOX_IMAGE || "mulmoterminal-sandbox";
const SHA_LABEL = "mulmoterminal.dockerfile.sha256";
const DOCKERFILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "Dockerfile.sandbox");

// Bin as a parameter (not a spawn-of-a-string-literal), mirroring server/infra/tmux.ts.
function run(bin: string, args: string[]): string {
  return execFileSync(bin, args, { encoding: "utf8" }).trim();
}
const docker = (args: string[]): string => run("docker", args);
const dockerfileSha = (): string => createHash("sha256").update(readFileSync(DOCKERFILE)).digest("hex");
const imageLabel = (): string => docker(["image", "inspect", IMAGE, "--format", `{{index .Config.Labels "${SHA_LABEL}"}}`]);
const imageId = (): string => docker(["image", "inspect", IMAGE, "--format", "{{.Id}}"]);

const checks: string[] = [];
function check(what: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    console.error(`✗ ${what}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`);
    process.exit(1);
  }
  checks.push(what);
}

// 1. A missing image gets built, and carries the Dockerfile's sha as its label.
check("ensureSandboxImage() builds the image", ensureSandboxImage(), true);
check("the image exists afterwards", sandboxImageExists(), true);
check("the image is labelled with the Dockerfile sha256", imageLabel(), dockerfileSha());

// 2. Called again with an unchanged Dockerfile it must NOT rebuild — same image id.
const idAfterFirstBuild = imageId();
check("a second call succeeds", ensureSandboxImage(), true);
check("an unchanged Dockerfile does not rebuild (same image id)", imageId(), idAfterFirstBuild);

// 3. A CHANGED Dockerfile must rebuild and re-label. This is the branch that actually
//    protects users: without it a stale image would outlive an edited Dockerfile forever.
//    A trailing comment changes the file (so the sha) without adding a layer, so the
//    rebuild is cache-fast. Restored afterwards so the checkout is left as found.
const original = readFileSync(DOCKERFILE);
try {
  appendFileSync(DOCKERFILE, "\n# ci-sandbox-image.ts: temporary edit to force a rebuild\n");
  const editedSha = dockerfileSha();
  check("the edit changed the Dockerfile sha", editedSha === original.toString() ? "unchanged" : "changed", "changed");
  check("a changed Dockerfile rebuilds", ensureSandboxImage(), true);
  check("the label follows the changed Dockerfile", imageLabel(), editedSha);
} finally {
  writeFileSync(DOCKERFILE, original);
}

console.log(checks.map((c) => `✓ ${c}`).join("\n"));
