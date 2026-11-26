// Whether a request under `/remote/<id>/api/…` is one the gateway forwards, and the path and query
// to send (#3506). Pure.
//
// The remote cannot tell which cell asked, so the rules a cell's directory implies are held here:
// a `cwd` must be a clean absolute path, and a parameter naming a path must stay inside it. The
// remotes are Linux, so paths are POSIX.
import { posix } from "node:path";
import { isRecord } from "../../../common/isRecord.js";
import { REMOTE_ROUTES, type RemoteRoute } from "../../../common/remoteRoutes.js";
import { SESSION_ID_RE } from "../../config/env.js";

export const REMOTE_PATH_MAX = 4096;
const SESSION_SEGMENT = ":sid";

export type ForwardDecision = { kind: "forward"; route: RemoteRoute; path: string } | { kind: "refuse"; status: 400 | 404; reason: string };

const refuse = (status: 400 | 404, reason: string): ForwardDecision => ({ kind: "refuse", status, reason });

/** The route's path with its session segments filled from `pathname`, or null when they differ. */
function filledPath(route: RemoteRoute, pathname: string): string | null {
  const want = route.path.split("/");
  const got = pathname.split("/");
  if (want.length !== got.length) return null;
  const same = want.every((segment, i) => (segment === SESSION_SEGMENT ? SESSION_ID_RE.test(got[i] ?? "") : segment === got[i]));
  return same ? pathname : null;
}

const isCleanAbsolute = (value: string): boolean =>
  value.startsWith("/") &&
  value.length <= REMOTE_PATH_MAX &&
  !value.includes("\0") &&
  posix.normalize(value) === value &&
  (value === "/" || !value.endsWith("/"));

/** Whether `value` names `root` or something below it, written absolute or relative to it. */
export function staysInside(root: string, value: string): boolean {
  if (value.includes("\0") || value.length > REMOTE_PATH_MAX) return false;
  const resolved = posix.resolve(root, value);
  return resolved === root || resolved.startsWith(root === "/" ? "/" : `${root}/`);
}

type QueryResult = { params: URLSearchParams } | { reason: string };

function forwardedQuery(route: RemoteRoute, query: Record<string, unknown>): QueryResult {
  const params = new URLSearchParams();
  const single = route.query.find((name) => query[name] !== undefined && typeof query[name] !== "string");
  if (single) return { reason: `${single} must be given once, as text` };
  route.query.forEach((name) => {
    const value = query[name];
    if (typeof value === "string") params.set(name, value);
  });
  if (route.key !== "cwd") return { params };
  const cwd = params.get("cwd");
  if (cwd === null || !isCleanAbsolute(cwd)) return { reason: "cwd must be a clean absolute path" };
  const escaping = (route.within ?? []).find((name) => {
    const value = params.get(name);
    return value !== null && !staysInside(cwd, value);
  });
  return escaping ? { reason: `${escaping} leaves ${cwd}` } : { params };
}

/** The forward for `method` on `pathname` (the remote's own `/api/…` path), or why not. */
export function decideForward(
  method: string,
  pathname: string,
  query: unknown,
  routes: Readonly<Record<string, RemoteRoute>> = REMOTE_ROUTES,
): ForwardDecision {
  const matched = Object.values(routes).find((route) => route.method === method.toUpperCase() && filledPath(route, pathname) !== null);
  if (!matched) return refuse(404, `${method.toUpperCase()} ${pathname} is not forwarded to a remote host`);
  const result = forwardedQuery(matched, isRecord(query) ? query : {});
  if ("reason" in result) return refuse(400, result.reason);
  const search = result.params.toString();
  return { kind: "forward", route: matched, path: search ? `${pathname}?${search}` : pathname };
}
