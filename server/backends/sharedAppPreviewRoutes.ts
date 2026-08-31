// The preview payload, over HTTP, for the pane that draws it.
//
// A GET rather than a field on some larger state: the answer changes every time the author edits a
// page or a declaration, and nothing in this server watches for that. It is asked when somebody
// wants to look, which is the same reason the self-containment check beside it is a button.
//
// It carries no `confirm` and takes no body, because it has nothing to confirm — `previewSharedApp`
// writes nothing. That is worth saying at the route, where a future reader deciding to "just add a
// POST that also deploys" would otherwise have to go and read the backend to find out.
//
// MulmoTerminal's own route. MulmoClaude has no counterpart to match — an app is a REPOSITORY and
// that host is single-root — which is the same reason `manageSharedApp` lives here.
import type { Express, Request, Response } from "express";
import { access } from "node:fs/promises";
import path from "node:path";
import { APP_MANIFEST_FILE } from "@mulmoclaude/core/collection/server";
import { previewSharedApp } from "./sharedApp/preview.js";
import { holdOpen, watchPreviewRecords } from "./sharedApp/previewWatch.js";
import { undoPreviewSubmission, writePreviewSubmission } from "./sharedApp/previewWrite.js";
import { performPreviewIntent } from "./sharedApp/previewIntent.js";
import { previewOwnLookup } from "./sharedApp/previewLookup.js";
import { requestBody } from "../routes/requestBody.js";
import { isRecord } from "../../common/isRecord.js";
import { workspaceForRoute } from "../routes/routeParams.js";
import type { PreviewIntent, PreviewSubmission, SharedAppPreview, SharedAppPreviewResponse } from "../../common/sharedAppPreview.js";

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Does this directory declare a shared app at all? Asked before anything else so the ordinary
 *  answer — "no, it is just a directory" — costs one `stat` rather than a Firestore session. */
async function declaresAnApp(root: string): Promise<boolean> {
  try {
    await access(path.join(root, APP_MANIFEST_FILE));
    return true;
  } catch {
    return false;
  }
}

/** The one way this pair of routes fails.
 *
 *  `headersSent` is checked because the handlers write their own answers — a throw after that would
 *  otherwise try to write a finished response and log `ERR_HTTP_HEADERS_SENT` over the real cause.
 *
 *  The message goes to the LOG and a fixed string to the browser: a Firestore error carries absolute
 *  paths off this machine and internals of a database the page has no business learning about. */
function fail(res: Response, err: unknown): void {
  console.error(`[shared-app preview] ${messageOf(err)}`);
  if (!res.headersSent) res.status(500).json({ error: "the preview could not be computed" });
}

async function respondPreview(req: Request, res: Response): Promise<void> {
  // The cell's directory, not the workspace. An app IS a repository, so "preview this app" means
  // the one the cell is open in — resolving it to the workspace would preview a different app than
  // the author is looking at, which is exactly the mistake `manageSharedApp` is scoped to avoid.
  const cwd = workspaceForRoute(req.query.cwd, res);
  if (cwd === null) return;

  // A directory with no `app.json` is not an error. Most directories are not shared apps, and the
  // pane asks about whichever one the cell happens to be open in — answering 404 would make the
  // ordinary case look like a fault in the server log.
  if (!(await declaresAnApp(cwd))) {
    res.json({ declared: false });
    return;
  }

  const result = await previewSharedApp(cwd);
  if (!result.ok) {
    // 200 with the problems on it. The declaration being wrong is an answer to the question asked,
    // not a failure to answer it — and the pane's whole job is to put those problems in front of
    // the author, which it cannot do from a status code.
    res.json({ declared: true, ok: false, problems: result.problems } satisfies SharedAppPreviewResponse);
    return;
  }
  // The WIRE shape, named field by field rather than spread. `previewSharedApp` also carries the
  // full published projection and the generated form's inputs, which this pane has no use for and
  // which would go to the browser for nobody to read.
  const preview: SharedAppPreview = {
    aid: result.aid,
    submit: result.submit,
    ...(result.articleCid === undefined ? {} : { articleCid: result.articleCid }),
    pages: result.pages,
    publicFace: result.publicFace,
    fromLiveApp: result.fromLiveApp,
    generatedForm: result.generatedForm,
    formInputs: result.formInputs,
    datasets: result.datasets,
    own: result.own,
    unreadable: result.unreadable,
    warnings: result.warnings,
  };
  res.json({ declared: true, ok: true, preview } satisfies SharedAppPreviewResponse);
}

/** The submission a preview accepted, narrowed off the request. */
function submissionOf(body: unknown): PreviewSubmission | null {
  if (!isRecord(body) || typeof body.cid !== "string" || !isRecord(body.values)) return null;
  const entries = Object.entries(body.values).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  // STRINGS ONLY, and the whole submission is refused rather than trimmed: the rules compare stored
  // values without coercing, so writing the string half of a mixed payload would produce a record
  // that differs BY TYPE from the identical-looking one the published page writes.
  if (entries.length !== Object.keys(body.values).length) return null;
  return { cid: body.cid, values: Object.fromEntries(entries) };
}

/** A correction's values, or null when the request does not describe a set of them.
 *
 *  Its own function rather than `submissionOf`'s inline filter, because the two differ in one place
 *  that matters: an empty map is a legitimate correction message (answered `nothing-to-correct` by
 *  name) and never a legitimate submission. */
function correctionValues(raw: unknown): Record<string, string> | null {
  if (!isRecord(raw)) return null;
  const entries = Object.entries(raw);
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === "string")) return null;
  return Object.fromEntries(entries);
}

/** The intent a member's page asked for, narrowed off the request.
 *
 *  SHAPE ONLY. Whether the move is legal, whether this reader may make it and whether the record is
 *  in a status it can leave are all `performPreviewIntent`'s, judged against the projection — this
 *  refuses what is not an intent at all, which is the same line the package's own reader draws. */
function intentOf(body: unknown): PreviewIntent | null {
  if (!isRecord(body) || !isRecord(body.page)) return null;
  const { id, audience } = body.page;
  if (typeof id !== "string" || (audience !== "public" && audience !== "member" && audience !== "roster")) return null;
  if (body.kind !== "transition" && body.kind !== "assign" && body.kind !== "withdraw" && body.kind !== "correct") return null;
  if (typeof body.cid !== "string" || typeof body.itemId !== "string") return null;
  // A withdrawal names no destination, and one arriving with a `to` is not a withdrawal with
  // decoration — it is an ask this host cannot describe, so it is not read as one.
  if (body.kind === "withdraw") {
    if (body.to !== undefined) return null;
    return { page: { id, audience }, kind: body.kind, cid: body.cid, itemId: body.itemId };
  }
  // A correction names none either, and carries values instead. STRINGS ONLY, and the whole message
  // is refused rather than trimmed — `submissionOf` above draws the same line for the same reason:
  // the rules compare stored values without coercing, so writing the string half of a mixed payload
  // produces a record that differs BY TYPE from the identical-looking one the published page
  // writes. An EMPTY map still passes: `nothing-to-correct` is a refusal with a name, and the page
  // is holding a promise while it happens.
  if (body.kind === "correct") {
    const values = correctionValues(body.values);
    if (body.to !== undefined || values === null) return null;
    return { page: { id, audience }, kind: body.kind, cid: body.cid, itemId: body.itemId, values };
  }
  if (typeof body.to !== "string") return null;
  return { page: { id, audience }, kind: body.kind, cid: body.cid, itemId: body.itemId, to: body.to };
}

/** The token naming one write this preview made — and NOT the record itself.
 *
 *  A cid and an id off the request would be a cid and an id of the caller's choosing, and undo
 *  deletes through the author's own handle: it is authorized to remove any record in the app, so a
 *  forged pair would take out a stranger's real submission and put the slot it held back to `open`.
 *  The record is looked up server-side from a token minted when the write was made. */
function undoTokenOf(body: unknown): string | null {
  if (!isRecord(body)) return null;
  const named = isRecord(body.written) ? body.written.token : body.token;
  return typeof named === "string" && named.length > 0 ? named : null;
}

async function respondIntent(req: Request, res: Response): Promise<void> {
  const cwd = workspaceForRoute(req.query.cwd, res);
  if (cwd === null) return;
  const asked = intentOf(requestBody(req.body));
  if (asked === null) {
    // The parent's own name for it, answered on a 200 for the reason the projection's problems are:
    // the ask being unreadable is an answer to the question, not a failure to answer it — and the
    // pane puts this word in front of the author, which it cannot do from a status code.
    res.json({ ok: false, error: "not-an-intent" });
    return;
  }
  res.json(await performPreviewIntent(cwd, asked));
}

/** One `view.mine(cid, key)`, answered. Out of the mount below for its line budget, and beside
 *  `respondIntent` for the same reason: the narrowing is the part with a decision in it.
 *
 *  An unreadable ask is `{ ok: false }` — "nobody looked" — and never `{ found: false }`, which
 *  would tell the page the author has not submitted. */
async function respondLookup(req: Request, res: Response): Promise<void> {
  const cwd = workspaceForRoute(req.query.cwd, res);
  if (cwd === null) return;
  const body = requestBody(req.body);
  const cid = typeof body.cid === "string" ? body.cid : "";
  const key = typeof body.key === "string" ? body.key : "";
  if (cid === "" || key === "") {
    res.json({ ok: false });
    return;
  }
  res.json(await previewOwnLookup(cwd, { cid, key }));
}

/** THE RECORDS, STREAMED while a page that watches them is open.
 *
 *  Server-sent events rather than a socket: this is one-way, it is text, and it needs no handshake
 *  — the pane opens an `EventSource` and the listener behind it is closed when the request is.
 *  And rather than a poll, which is what the pane would otherwise have to do: a listener fires when
 *  the records change and at no other time, which is what the published page gets.
 *
 *  A HEARTBEAT, as a comment line: an idle stream through a proxy is a stream that gets closed, and
 *  a comment is the one thing an `EventSource` reads and does not deliver. It carries no records and
 *  asks the database nothing — it is not the poll wearing a hat. */
async function streamRecords(req: Request, res: Response): Promise<void> {
  const cwd = workspaceForRoute(req.query.cwd, res);
  if (cwd === null) return;
  // WRITTEN ONLY ONCE THE STREAM HAS BEGUN. `onSnapshot` delivers what it already has as soon as it
  // is subscribed, and that can be before this response has any headers on it — which would send
  // the first change as an ordinary 200 body and leave the pane reading rows it cannot parse.
  let sending = false;
  const held: string[] = [];
  const send = (line: string) => {
    if (sending) res.write(line);
    else held.push(line);
  };
  // The ORDER is `holdOpen`'s, and it is the point of that function: the cleanup is registered
  // before the watch is opened, because opening it is asynchronous and a pane that changes page
  // meanwhile closes this request while it runs.
  await holdOpen({
    onClose: (release) => req.on("close", release),
    open: () => watchPreviewRecords(cwd, (change) => send(`data: ${JSON.stringify(change)}\n\n`)),
    begin: () => {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      sending = true;
      for (const line of held) res.write(line);
      held.length = 0;
    },
    beat: () => {
      const timer = setInterval(() => res.write(": open\n\n"), HEARTBEAT_MS);
      return () => clearInterval(timer);
    },
    // NOTHING TO WATCH — no app here, no page that declared `live`, or no session. Answered 204,
    // which is the one status an `EventSource` treats as "do not come back": an opened-then-ended
    // 200 stream is reconnected for ever, and every reconnection recomputes the whole preview.
    nothing: () => res.status(204).end(),
  });
}

/** Often enough that nothing between here and the pane calls the stream idle, rarely enough to be
 *  invisible. Both ends are on this machine; this is about proxies, not about latency. */
const HEARTBEAT_MS = 25_000;

/** The records as they change. Its own mount because it is the one route here that does not end:
 *  the others answer a question, this one stays open until the pane goes away. */
function mountRecordStream(app: Express): void {
  app.get("/api/shared-app/preview/watch", (req, res) => {
    void (async () => {
      try {
        await streamRecords(req, res);
      } catch (err) {
        fail(res, err);
      }
    })();
  });
}

export function mountSharedAppPreviewRoutes(app: Express): void {
  // The write the author accepted in the confirmation, performed as them.
  //
  // A POST because it writes, and separate from the projection route for the same reason: that one
  // is asked constantly and answers a question, this one happens once and changes the database.
  app.post("/api/shared-app/preview/submit", (req, res) => {
    void (async () => {
      try {
        const cwd = workspaceForRoute(req.query.cwd, res);
        if (cwd === null) return;
        const submission = submissionOf(requestBody(req.body));
        if (submission === null) {
          res.json({ ok: false, error: "not-a-submission" });
          return;
        }
        res.json(await writePreviewSubmission(cwd, submission.cid, submission.values));
      } catch (err) {
        fail(res, err);
      }
    })();
  });

  // A MOVE — a member's, or the one a visitor makes on their own row on the public page — performed
  // as the author. Its own route rather than a shape on the one above,
  // because the two are different operations against different rules: a submission CREATES a record
  // as a visitor would, and this UPDATES one somebody already owns — or removes it. Sharing a route
  // would mean one narrowing deciding which, over a body a sandboxed page's parent composed.
  app.post("/api/shared-app/preview/intent", (req, res) => {
    void respondIntent(req, res).catch((err: unknown) => fail(res, err));
  });

  // "Have I already got this row?" — a READ, for the one key the page names, performed with the
  // author's own credentials against an id this host builds. Its own route because it answers in a
  // different vocabulary from the two above: `{ known, found }` rather than `{ ok, error }`, and a
  // page settling one as the other reads "not found" as "refused".
  app.post("/api/shared-app/preview/lookup", (req, res) => {
    void respondLookup(req, res).catch((err: unknown) => fail(res, err));
  });

  // Taking one back. Its own route rather than a flag on the one above, because the author presses
  // a different button for a different reason and the two must not be able to be confused.
  app.post("/api/shared-app/preview/undo", (req, res) => {
    void (async () => {
      try {
        // The directory is still resolved, because a request naming none is a bug in the caller —
        // but it is NOT passed on. Which app the record belongs to is part of what the token knows.
        if (workspaceForRoute(req.query.cwd, res) === null) return;
        const named = undoTokenOf(requestBody(req.body));
        if (named === null) {
          res.json({ ok: false, error: "not-a-record" });
          return;
        }
        res.json(await undoPreviewSubmission(named));
      } catch (err) {
        fail(res, err);
      }
    })();
  });

  // "Is there anything to preview here?" — one `stat`, and its own route rather than a flag on the
  // one below. The pane asks it for every directory a cell is open in, and computing a whole
  // publish projection to answer "no" would put a Firestore session behind a question about a
  // file's existence.
  app.get("/api/shared-app/declared", (req, res) => {
    void (async () => {
      try {
        const cwd = workspaceForRoute(req.query.cwd, res);
        if (cwd === null) return;
        res.json({ declared: await declaresAnApp(cwd) });
      } catch (err) {
        // `declaresAnApp` swallows its own failures, but the guard and the write can still throw,
        // and an unhandled rejection here is a request that never gets an answer at all.
        fail(res, err);
      }
    })();
  });

  mountRecordStream(app);

  app.get("/api/shared-app/preview", (req, res) => {
    void (async () => {
      try {
        await respondPreview(req, res);
      } catch (err) {
        fail(res, err);
      }
    })();
  });
}
