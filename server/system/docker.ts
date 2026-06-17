// Docker sandbox lifecycle for MulmoTerminal: liveness probe + image
// build/refresh. Adapted from mulmoclaude's server/system/docker.ts.
//
// When Docker is available the server runs every `claude` session inside
// the mulmoterminal-sandbox image (see buildSandboxDockerArgs). When it
// is not — or DISABLE_SANDBOX=1 — sessions run directly on the host.
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join, resolve as resolvePath } from "path";

const execFileAsync = promisify(execFile);

const IMAGE_NAME = "mulmoterminal-sandbox";
const LABEL_KEY = "mulmoterminal.dockerfile.sha256";

// Dockerfile.sandbox ships at the package root, two levels up from this
// file (server/system/docker.ts). Resolve from __dirname rather than
// process.cwd() so it works regardless of where the server is launched.
const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolvePath(__dirname, "..", "..");
const DOCKERFILE_PATH = join(PACKAGE_ROOT, "Dockerfile.sandbox");

let _dockerEnabled: boolean | null = null;

/** A 1500ms `docker ps` probe: succeeds only when the client is
 *  installed AND the daemon is reachable. */
async function isDockerLive(): Promise<boolean> {
  try {
    await execFileAsync("docker", ["ps", "-q"], { timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

/** Whether sessions should run sandboxed. Cached after the first call.
 *  DISABLE_SANDBOX=1 forces the host (unsandboxed) path. */
export async function isDockerAvailable(): Promise<boolean> {
  if (process.env.DISABLE_SANDBOX === "1") return false;
  if (_dockerEnabled !== null) return _dockerEnabled;
  _dockerEnabled = await isDockerLive();
  return _dockerEnabled;
}

function getDockerfileSha256(): string {
  return createHash("sha256").update(readFileSync(DOCKERFILE_PATH)).digest("hex");
}

function buildImage(sha: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Invoking the `docker` CLI from PATH is intentional — it's the sandbox's
    // core dependency, the same way the server spawns `claude` from PATH.
    const buildArgs = ["build", "-t", IMAGE_NAME, "--label", `${LABEL_KEY}=${sha}`, "-f", DOCKERFILE_PATH, "--load", PACKAGE_ROOT];
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed CLI dependency
    const proc = spawn("docker", buildArgs, { stdio: ["ignore", "inherit", "inherit"] });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`docker build exited with code ${code}`))));
  });
}

/** Build (or rebuild) the sandbox image when Dockerfile.sandbox changes.
 *  The current Dockerfile's sha256 is stored as an image label and
 *  compared on each startup. */
export async function ensureSandboxImage(): Promise<void> {
  const expectedSha = getDockerfileSha256();

  let needsBuild = false;
  try {
    const { stdout } = await execFileAsync("docker", ["image", "inspect", IMAGE_NAME, "--format", `{{index .Config.Labels "${LABEL_KEY}"}}`]);
    if (stdout.trim() !== expectedSha) {
      console.log("[sandbox] Dockerfile.sandbox changed — rebuilding sandbox image...");
      needsBuild = true;
    }
  } catch {
    console.log("[sandbox] building sandbox image (first time only, may take a few minutes)...");
    needsBuild = true;
  }

  if (needsBuild) {
    await buildImage(expectedSha);
    console.log("[sandbox] sandbox image ready.");
  }
}

export { IMAGE_NAME };
