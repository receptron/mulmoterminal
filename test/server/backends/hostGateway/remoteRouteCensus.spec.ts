// @vitest-environment node
// Every /api route this server mounts is decided for remote hosts (#3506): forwarded (the table in
// common/remoteRoutes.ts), never forwarded with a reason, or not decided yet. A route added without
// a decision fails here, as a cell action without one fails in ON_REMOTE_CELL.
//
// The routes are read from the real app, mounted in a child process with a scratch HOME, so a route
// mounted under a constant or a RegExp is counted as surely as a literal one.
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { REMOTE_ROUTES, routeSignature } from "../../../../common/remoteRoutes.js";
import { makeTempDir } from "../../../support/tempDir.js";
import { NEVER_FORWARDED, UNDECIDED, UNDECIDED_CEILING } from "./remoteRouteCensusLists.js";

const LISTER = fileURLToPath(new URL("./listAppRoutes.ts", import.meta.url));
const LIST_TIMEOUT_MS = 90_000;

// A parameter's name differs between the table (`:sid`) and the route that mounts it (`:id`).
const shapeOf = (signature: string): string => signature.replace(/:[A-Za-z]+/g, ":param");
const isApiRoute = (signature: string): boolean => {
  const path = signature.slice(signature.indexOf(" ") + 1);
  return path.startsWith("/api/") || path.startsWith("/^\\/api\\/");
};

const forwarded = Object.values(REMOTE_ROUTES).map((route) => shapeOf(routeSignature(route.method, route.path)));
const never = Object.values(NEVER_FORWARDED).flat().map(shapeOf);
const undecided = UNDECIDED.map(shapeOf);

let mounted: string[] = [];
beforeAll(() => {
  const home = makeTempDir("mt-route-census-");
  const output = execFileSync(process.execPath, ["--import", "tsx", LISTER], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    encoding: "utf8",
    timeout: LIST_TIMEOUT_MS,
  });
  const parsed: unknown = JSON.parse(output.trim().split("\n").at(-1) ?? "[]");
  mounted = (Array.isArray(parsed) ? parsed : []).filter((value): value is string => typeof value === "string" && isApiRoute(value)).map(shapeOf);
}, LIST_TIMEOUT_MS);

describe("the remote route census", () => {
  it("reads the server's routes", () => {
    expect(mounted).toContain("GET /api/git-status");
    expect(mounted).toContain("POST /api/shutdown");
  });

  it("finds a decision for every /api route the server mounts", () => {
    const decided = new Set([...forwarded, ...never, ...undecided]);
    expect(mounted.filter((route) => !decided.has(route))).toEqual([]);
  });

  it("lists nothing the server does not mount", () => {
    const live = new Set(mounted);
    expect([...forwarded, ...never, ...undecided].filter((route) => !live.has(route))).toEqual([]);
  });

  it("decides each route once", () => {
    const all = [...forwarded, ...never, ...undecided];
    expect(all.filter((route, i) => all.indexOf(route) !== i)).toEqual([]);
  });

  it("never lets the undecided list grow", () => {
    expect(UNDECIDED.length).toBeLessThanOrEqual(UNDECIDED_CEILING);
  });

  it("forwards none of the routes that stop, reconfigure or speak for the remote", () => {
    ["POST /api/shutdown", "POST /api/config", "POST /api/hook", "POST /api/mcp/:param", "POST /api/processes/kill", "POST /api/terminal/:param/reply"].forEach(
      (route) => expect(never).toContain(route),
    );
  });
});
