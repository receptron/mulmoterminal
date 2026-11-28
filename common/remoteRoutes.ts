// What the gateway forwards to a remote host under `/remote/<id>/api/…` (#3506). Every forwarded
// route is listed here with its method, what keys it, and the query parameters it may carry;
// nothing outside this table crosses, and test/server/backends/hostGateway/remoteRouteCensus.spec.ts
// makes every route this server mounts either listed here or refused with a reason.
//
// A forwarded request reaches the remote with the power of the remote's own UI, so adding a row is
// a decision about what a page on this machine may do there, not plumbing.

import { AGENT_SESSION_LIST_PATHS } from "./agentSessionList.js";
import { DROP_FILENAME_HEADER } from "./dropUpload.js";
import { MD_PREVIEW_EMBED_PARAM, MD_PREVIEW_TOKEN_PARAM } from "./mdPreviewMessage.js";
import { PREVIEW_THEME_PARAMS } from "./previewTheme.js";

export type RemoteRouteMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface RemoteRoute {
  method: RemoteRouteMethod;
  /** The remote's own path. A `:sid` segment is a session id; a final `*` is the rest of the path,
   *  one or more segments, none of them empty, `.` or `..`. */
  path: string;
  /** cwd: the request names a directory, `query.cwd`, which the other paths stay inside.
   *  session: it names one session, by a `:sid` segment or else by `query.session` (or `sessionId`);
   *  a `query.cwd` beside it must be a clean absolute path. none: neither. */
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
  /** slow: the remote may take as long as the browser waits for it (a search, a whole file index). */
  wait?: "slow";
  /** The JSON body's fields naming a path, each an absolute path inside `cwd` when present. For a
   *  route that reads its directory from the body: the query's `cwd` is what the gateway pins it to. */
  bodyWithin?: readonly string[];
  /** The JSON body's `kind` must be one of these: a route that reads and writes on one path is
   *  forwarded for its reads, and a body naming no kind is the agent's own call, not a view's. */
  bodyKinds?: readonly string[];
}

// The Files pane's routes: rooted at the cell's directory, and a `path` never leaves it.
const browse = (method: RemoteRouteMethod, route: string, access: "read" | "write", query: readonly string[] = ["cwd", "path"]): RemoteRoute => ({
  method,
  path: `/api/files/browse/${route}`,
  key: "cwd",
  access,
  query,
  within: ["path"],
});

// A session's own record, read on its host: `cwd` only says where its log lives.
const transcript = (route: string, query: readonly string[], method: RemoteRouteMethod = "GET", access: "read" | "write" = "read"): RemoteRoute => ({
  method,
  path: `/api/transcript/${route}`,
  key: "session",
  access,
  query: ["session", "cwd", ...query],
});

// A write to the cell's repo, which names its directory in the body; the query carries it too.
const repoWrite = (path: string, bodyWithin: readonly string[]): RemoteRoute => ({
  method: "POST",
  path,
  key: "cwd",
  access: "write",
  query: ["cwd"],
  bodyWithin,
});

// A plugin view's dispatch, for the kinds that only read.
const pluginReads = (toolName: string, bodyKinds: readonly string[]): RemoteRoute => ({
  method: "POST",
  path: `/api/plugin/${toolName}`,
  key: "none",
  access: "read",
  query: [],
  bodyKinds,
});

// The launch form's resume list: one agent's past conversations in a directory, read on its host.
const sessionList = (path: string): RemoteRoute => ({ method: "GET", path, key: "cwd", access: "read", query: ["cwd"] });

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
  filesList: browse("GET", "list", "read"),
  filesText: browse("GET", "text", "read"),
  filesVersion: browse("GET", "version", "read"),
  filesHead: browse("GET", "head", "read"),
  filesGitStatus: browse("GET", "git-status", "read"),
  filesLines: browse("GET", "lines", "read", ["cwd", "path", "line"]),
  filesBackups: browse("GET", "backups", "read"),
  filesBackup: browse("GET", "backup", "read", ["cwd", "path", "id"]),
  filesIndex: { ...browse("GET", "index", "read", ["cwd"]), wait: "slow" },
  filesSearch: { ...browse("GET", "search", "read", ["cwd", "q", "regex", "case"]), wait: "slow" },
  filesTrashAvailable: { method: "GET", path: "/api/files/browse/trash", key: "none", access: "read", query: [] },
  filesWrite: browse("PUT", "write", "write"),
  filesBankBackup: browse("PUT", "backup", "write"),
  filesCreate: browse("POST", "create", "write"),
  filesRename: browse("POST", "rename", "write"),
  filesTrash: browse("POST", "trash", "write"),
  transcriptPrompts: transcript("prompts", ["agent"]),
  transcriptView: transcript("view", ["before"]),
  transcriptTimeline: transcript("timeline", []),
  transcriptLastTurn: transcript("last-turn", ["agent", "as"]),
  // A relay's `dest` is only ever a key on the remote, never a path it reads.
  transcriptRelay: transcript("relay", ["agent", "dest"]),
  transcriptRelayMark: transcript("relay-mark", ["agent", "dest"], "POST", "write"),
  // The Tools pane: a session's tool calls, and the tools its groups give it.
  toolCalls: { method: "GET", path: "/api/tool-calls/:sid", key: "session", access: "read", query: [] },
  // The Canvas: a session's cards. A view's change of state is not written back: that route is the
  // agent's own, and forwarding it would let a page put a card in the remote session.
  toolResults: { method: "GET", path: "/api/agent/toolResults/:sid", key: "session", access: "read", query: [] },
  tools: { method: "GET", path: "/api/tools", key: "session", access: "read", query: ["sessionId"] },
  // An AskUserQuestion dialog: the one a session is blocked on, and an answer, typed by the host.
  question: { method: "GET", path: "/api/question/:sid", key: "session", access: "read", query: [] },
  questionAnswer: { method: "POST", path: "/api/question/:sid/answer", key: "session", access: "write", query: [] },
  // The launch form's worktree section: a repo's managed worktrees, and a new one, which `git worktree
  // add` checks out in full.
  worktrees: { method: "GET", path: "/api/worktrees", key: "cwd", access: "read", query: ["cwd"] },
  worktreeCreate: { ...repoWrite("/api/worktrees/create", ["repoDir"]), wait: "slow" },
  worktreeDiff: { method: "GET", path: "/api/worktrees/diff", key: "cwd", access: "read", query: ["cwd"] },
  worktreePush: repoWrite("/api/worktrees/push", ["cwd"]),
  worktreePr: repoWrite("/api/worktrees/pr", ["cwd"]),
  worktreeRemove: repoWrite("/api/worktrees/remove", ["repoDir", "path"]),
  workComment: repoWrite("/api/work-comment", ["cwd"]),
  claudeSessions: sessionList(AGENT_SESSION_LIST_PATHS.claude),
  codexSessions: sessionList(AGENT_SESSION_LIST_PATHS.codex),
  antigravitySessions: sessionList(AGENT_SESSION_LIST_PATHS.antigravity),
  grokSessions: sessionList(AGENT_SESSION_LIST_PATHS.grok),
  museSessions: sessionList(AGENT_SESSION_LIST_PATHS.muse),
  copilotSessions: sessionList(AGENT_SESSION_LIST_PATHS.copilot),
  cursorSessions: sessionList(AGENT_SESSION_LIST_PATHS.cursor),
  // A Canvas card's own reads: a document, the source of an HTML page, a model and a workbook. None
  // of these plugins roots its path, on the remote or here (CLAUDE.md, "Four surfaces open a file").
  documentReads: pluginReads("presentDocument", ["loadDoc", "marpThemes", "bookmarkPattern"]),
  htmlReads: pluginReads("presentHtml", ["loadHtml"]),
  shapeReads: pluginReads("presentShapeScript", ["loadShape"]),
  spreadsheetReads: pluginReads("presentSpreadsheet", ["loadSpreadsheet"]),
} as const satisfies Record<string, RemoteRoute>;

export type RemoteRouteName = keyof typeof REMOTE_ROUTES;

// A document the remote renders under its own sandboxing policy, for the Files pane's Preview: the
// query a Preview URL carries (filesPreviewSrc.ts), its path held inside the cell's directory.
const rendered = (route: string): RemoteRoute => ({
  method: "GET",
  path: `/api/files/browse/${route}`,
  key: "cwd",
  access: "read",
  query: ["cwd", "path", "v", MD_PREVIEW_EMBED_PARAM, MD_PREVIEW_TOKEN_PARAM, ...Object.keys(PREVIEW_THEME_PARAMS)],
  within: ["path"],
});

/** What the gateway serves as BYTES under `/remote/<id>/bytes/…`, rather than as JSON: a file the
 *  Files pane shows as a picture, a PDF or media, the documents it previews, and an HTML card's page.
 *  Each response must carry the remote's own `nosniff`, and its `sandbox` policy unless it is a PDF
 *  or media, which the remote serves unsandboxed because a browser cannot open them sandboxed
 *  (server/backends/files). */
export const REMOTE_BYTE_ROUTES = {
  filesRaw: { method: "GET", path: "/api/files/raw", key: "cwd", access: "read", query: ["cwd", "path"], within: ["path"] },
  filesMd: rendered("md"),
  filesTable: rendered("table"),
  filesJson: rendered("json"),
  // An HTML card's page, in the iframe; both mounts serve documents only, under their own sandbox.
  htmlArtifactPage: { method: "GET", path: "/artifacts/html/*", key: "none", access: "read", query: ["v", "r"] },
  htmlFilePage: { method: "GET", path: "/htmlfile/*", key: "none", access: "read", query: ["v", "r"] },
} as const satisfies Record<string, RemoteRoute>;

/** How a route is named in the census: its method and the path as the server mounts it. */
export const routeSignature = (method: string, path: string): string => `${method.toUpperCase()} ${path}`;
