import type { Express, Request } from "express";
import { spawn } from "node:child_process";
import { resolveDirRequest } from "../files/dirRequest.js";

// Convert a git remote URL to its GitHub repository web URL, or null when the
// remote isn't on github.com. Pure (no I/O) so it's exhaustively unit-tested.
// Handles the common remote forms:
//   git@github.com:owner/repo.git           (scp-like SSH)
//   ssh://git@github.com[:port]/owner/repo  (SSH URL)
//   https://[user[:token]@]github.com/owner/repo.git
//   git://github.com/owner/repo.git
export function parseGithubWebUrl(remoteUrl: string): string | null {
  const url = remoteUrl.trim();
  if (!url) return null;

  // scp-like form has no scheme: user@host:path. Everything else (https/ssh/git
  // URLs, with optional creds/port) is handled by the standard URL parser.
  const scp = /^[^/@]+@([^/:]+):([^:]+)$/.exec(url);
  const { host, rawPath } = scp ? { host: scp[1], rawPath: scp[2] } : fromUrl(url);
  if (!host || host.toLowerCase() !== "github.com") return null;

  const segments = rawPath
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean);
  if (segments.length < 2) return null;
  return `https://github.com/${segments[0]}/${segments[1]}`;
}

function fromUrl(url: string): { host: string; rawPath: string } {
  try {
    const parsed = new URL(url);
    return { host: parsed.hostname, rawPath: parsed.pathname.replace(/^\/+/, "") };
  } catch {
    return { host: "", rawPath: "" };
  }
}

// Read the dir's `origin` remote and map it to a GitHub web URL (null if the dir
// isn't a git repo, has no origin, git is missing, or origin isn't GitHub).
export function resolveGithubUrl(dir: string): Promise<string | null> {
  return new Promise((resolve) => {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- 'git' is a standard tool resolved from PATH in this local dev server; dir is passed via -C as a separate argv (no shell)
    const child = spawn("git", ["-C", dir, "config", "--get", "remote.origin.url"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk.toString()));
    child.on("error", () => resolve(null)); // git not installed
    child.on("close", () => resolve(parseGithubWebUrl(out)));
  });
}

interface GitRemoteOptions {
  isAllowedOrigin: (origin?: string) => boolean;
}

// POST /api/git-remote { path } -> { githubUrl: string | null }. Lets the browser
// (which can't read the filesystem) learn whether a cell's working dir is a
// GitHub repo, and where its repository page is. Same-origin guarded like the
// other local-only routes.
export function mountGitRemoteRoute(app: Express, { isAllowedOrigin }: GitRemoteOptions) {
  app.post("/api/git-remote", async (req: Request, res) => {
    const dir = resolveDirRequest(req, res, isAllowedOrigin);
    if (!dir) return;
    res.json({ githubUrl: await resolveGithubUrl(dir) });
  });
}
