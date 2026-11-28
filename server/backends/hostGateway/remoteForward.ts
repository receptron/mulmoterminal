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
const SLUG_SEGMENT = ":slug";
const REST_SEGMENT = "*";

export type ForwardDecision = { kind: "forward"; route: RemoteRoute; path: string } | { kind: "refuse"; status: 400 | 404; reason: string };

const refuse = (status: 400 | 404, reason: string): ForwardDecision => ({ kind: "refuse", status, reason });

// The remote decodes each segment and refuses one still naming a parent, so only the raw spelling is
// held here.
const isRestSegment = (given: string): boolean => given !== "" && given !== "." && given !== ".." && !given.includes("\0");

function fills(segment: string, given: string): boolean {
  if (segment === SESSION_SEGMENT) return SESSION_ID_RE.test(given);
  return segment === SLUG_SEGMENT ? isRestSegment(given) : segment === given;
}

/** The route's path with its session segments filled from `pathname`, or null when they differ. */
function filledPath(route: RemoteRoute, pathname: string): string | null {
  const want = route.path.split("/");
  const got = pathname.split("/");
  const rest = want.at(-1) === REST_SEGMENT;
  const fixed = rest ? want.slice(0, -1) : want;
  if (rest ? got.length <= fixed.length : got.length !== want.length) return null;
  const same = fixed.every((segment, i) => fills(segment, got[i] ?? "")) && got.slice(fixed.length).every(isRestSegment);
  return same && pathname.length <= REMOTE_PATH_MAX ? pathname : null;
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
  if (route.key === "session") return sessionQuery(route, params);
  if (route.key !== "cwd") return { params };
  const cwd = params.get("cwd");
  if (cwd === null || !isCleanAbsolute(cwd)) return { reason: "cwd must be a clean absolute path" };
  const escaping = (route.within ?? []).find((name) => {
    const value = params.get(name);
    return value !== null && !staysInside(cwd, value);
  });
  return escaping ? { reason: `${escaping} leaves ${cwd}` } : { params };
}

const SESSION_PARAMS = ["session", "sessionId"] as const;

// A session named by the query rather than the path is held to the same id rule.
function sessionQuery(route: RemoteRoute, params: URLSearchParams): QueryResult {
  const named = SESSION_PARAMS.find((name) => route.query.includes(name));
  const session = named === undefined ? null : params.get(named);
  if (named !== undefined && (session === null || !SESSION_ID_RE.test(session))) return { reason: `${named} must be a session id` };
  const cwd = params.get("cwd");
  return cwd !== null && !isCleanAbsolute(cwd) ? { reason: "cwd must be a clean absolute path" } : { params };
}

// A path the body names is held to the query's `cwd` like one in the query, and written absolute: the
// remote expands a `~` the gateway cannot see the meaning of.
function bodyEscape(route: RemoteRoute, cwd: string | null, body: unknown): string | null {
  const fields = route.bodyWithin ?? [];
  if (fields.length === 0) return null;
  const given = isRecord(body) ? body : {};
  const bad = fields.find((name) => {
    const value = given[name];
    return value !== undefined && (typeof value !== "string" || cwd === null || !isCleanAbsolute(value) || !staysInside(cwd, value));
  });
  return bad === undefined ? null : `${bad} must be an absolute path inside ${cwd ?? "the cwd"}`;
}

// A body for a route that forwards some of its kinds names one of them; no kind is no forward.
function kindRefused(route: RemoteRoute, body: unknown): string | null {
  const kinds = route.bodyKinds;
  if (kinds === undefined) return null;
  const field = route.bodyKindField ?? "kind";
  const kind = isRecord(body) ? body[field] : undefined;
  if (!isRecord(body) || typeof kind !== "string" || !kinds.includes(kind)) return `${route.path} forwards only ${field} ${kinds.join(" / ")}`;
  return fieldsRefused(route, field, kind, body);
}

function fieldsRefused(route: RemoteRoute, field: string, kind: string, body: Record<string, unknown>): string | null {
  const fields = route.kindFields?.[kind];
  if (fields === undefined) return null;
  const extra = Object.keys(body).find((key) => key !== field && !fields.includes(key));
  return extra === undefined ? null : `${route.path} forwards kind ${kind} only with ${fields.join(" / ")}, not ${extra}`;
}

/** The forward for `method` on `pathname` (the remote's own `/api/…` path), or why not. `body` is the
 *  parsed JSON body, for a route whose body names a path. */
export function decideForward(
  method: string,
  pathname: string,
  query: unknown,
  routes: Readonly<Record<string, RemoteRoute>> = REMOTE_ROUTES,
  body: unknown = undefined,
): ForwardDecision {
  const matched = Object.values(routes).find((route) => route.method === method.toUpperCase() && filledPath(route, pathname) !== null);
  if (!matched) return refuse(404, `${method.toUpperCase()} ${pathname} is not forwarded to a remote host`);
  const result = forwardedQuery(matched, isRecord(query) ? query : {});
  if ("reason" in result) return refuse(400, result.reason);
  const escape = bodyEscape(matched, result.params.get("cwd"), body) ?? kindRefused(matched, body);
  if (escape !== null) return refuse(400, escape);
  const search = result.params.toString();
  return { kind: "forward", route: matched, path: search ? `${pathname}?${search}` : pathname };
}
