// What the gateway forwards to a remote host under `/remote/<id>/api/…` (#3506). Every forwarded
// route is listed here with its method, what keys it, and the query parameters it may carry;
// nothing outside this table crosses, and test/server/backends/hostGateway/remoteRouteCensus.spec.ts
// makes every route this server mounts either listed here or refused with a reason.
//
// A forwarded request reaches the remote with the power of the remote's own UI, so adding a row is
// a decision about what a page on this machine may do there, not plumbing.

import { DROP_FILENAME_HEADER } from "./dropUpload.js";

export type RemoteRouteMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface RemoteRoute {
  method: RemoteRouteMethod;
  /** The remote's own path. A `:sid` segment is a session id. */
  path: string;
  /** cwd: the request names a directory, `query.cwd`, which the other paths stay inside.
   *  session: the path names one. none: neither. */
  key: "cwd" | "session" | "none";
  access: "read" | "write";
  /** The query parameters forwarded; any other is dropped. */
  query: readonly string[];
  /** Of those, the ones naming a path, which must stay inside `cwd`. */
  within?: readonly string[];
  /** raw: the body is bytes (a dropped file), read before any JSON parser and sent as they came. */
  body?: "raw";
  /** The request headers forwarded besides the gateway's own; any other is dropped. */
  headers?: readonly string[];
}

export const REMOTE_ROUTES = {
  gitStatus: { method: "GET", path: "/api/git-status", key: "cwd", access: "read", query: ["cwd", "fresh"] },
  dirConfig: { method: "GET", path: "/api/dir-config", key: "cwd", access: "read", query: ["cwd"] },
  prPhase: { method: "GET", path: "/api/pr-phase", key: "cwd", access: "read", query: ["cwd"] },
  header: { method: "GET", path: "/api/header", key: "cwd", access: "read", query: ["cwd", "agent", "session", "model"] },
  scripts: { method: "GET", path: "/api/scripts", key: "cwd", access: "read", query: ["cwd"] },
  skills: { method: "GET", path: "/api/skills", key: "cwd", access: "read", query: ["cwd"] },
  memo: { method: "POST", path: "/api/session/:sid/memo", key: "session", access: "write", query: [] },
  terminate: { method: "POST", path: "/api/session/:sid/terminate", key: "session", access: "write", query: [] },
  drop: {
    method: "POST",
    path: "/api/session/:sid/drop",
    key: "session",
    access: "write",
    query: [],
    body: "raw",
    headers: ["content-type", DROP_FILENAME_HEADER],
  },
} as const satisfies Record<string, RemoteRoute>;

export type RemoteRouteName = keyof typeof REMOTE_ROUTES;

/** How a route is named in the census: its method and the path as the server mounts it. */
export const routeSignature = (method: string, path: string): string => `${method.toUpperCase()} ${path}`;
