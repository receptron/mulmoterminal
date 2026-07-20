// Remote-host command handlers for MulmoTerminal.
//
// Each handler runs in-process on the host, so it bypasses the HTTP layer and
// calls the collection / feeds / accounting engines directly. The result shapes
// match MulmoClaude's handlers exactly, so one phone client (mulmoserver) drives
// either host.
//
// Covers read-only lists, startChat (text + image attachments), and mobile
// custom views (getRemoteView / getRemoteViewItems / mutateRemoteViewItem).
import { discoverCollections, listItems, loadCollection, toDetail, toSummary } from "@mulmoclaude/core/collection/server";
import { listFeeds, readFeedState } from "@mulmoclaude/core/feeds/server";
import { normalizeFields, normalizeMutate } from "@mulmoclaude/core/remote-view";
import { listBooks } from "@mulmoclaude/accounting-plugin/server";
import type { CommandHandlers, JsonObject, JsonValue } from "@mulmoclaude/core/remote-host";

import { readShortcuts } from "../shortcuts.js";
import { googleCalendarColors, googleCalendarCreateEvent, googleCalendarListCalendars, googleCalendarListEvents } from "./googleCalendar.js";
import { discoverSkillNames } from "./skills.js";
import { clampLimit, clampOffset, deriveItems, pageResult } from "./collectionPage.js";
import {
  buildRemoteView,
  mutateRemoteView,
  mutateRemoteViewFailureMessage,
  remoteViewFailureMessage,
  remoteViewItems,
  remoteViewItemsFailureMessage,
} from "../remoteView.js";
import type { Attachment } from "./ingestAttachments.js";
import { createTerminalInputSender } from "./terminalInput.js";
import type { TerminalSessionSummary } from "./terminalScreen.js";

export interface RemoteHostHandlerDeps {
  workspace: string;
  // Start a visible chat seeded with `message`; returns the new session id.
  spawnChat: (message: string) => { chatId: string };
  // Download the phone's staged uploads (by storage_id) into the workspace and
  // return path-only attachments (remoteHost/ingestAttachments.ts).
  ingest: (storageIds: string[]) => Promise<Attachment[]>;
  // The phone's remote terminal view (#435) — the picker's list and one session's
  // current screen. Wired in server/index.ts, where the PTY table lives.
  listTerminalSessions: () => Promise<TerminalSessionSummary[]>;
  captureTerminalScreen: (sessionId: string) => Promise<string>;
  // Type into one session's live PTY (#445). Returns false when no PTY is attached
  // in this process — a tmux session that outlived a restart stays viewable but not
  // writable from here.
  writeToSession: (sessionId: string, chunk: string) => boolean;
}

// Parse the optional `attachments` param ([{ storage_id }]) into storage ids. A
// malformed shape rejects the whole command: the remote already uploaded the
// bytes and is waiting, so a surfaced error beats a chat missing its file.
const readStorageIds = (attachments: JsonValue | undefined): string[] => {
  if (attachments == null) return [];
  if (!Array.isArray(attachments)) throw new Error("attachments must be an array of { storage_id }");
  return attachments.map((entry) => {
    const storageId = entry && typeof entry === "object" && !Array.isArray(entry) ? entry.storage_id : undefined;
    if (typeof storageId !== "string" || storageId.length === 0) throw new Error("each attachments entry must be { storage_id: string }");
    return storageId;
  });
};

// The PTY-driven `claude` can't take image content blocks, so reference the
// saved files by their workspace path in the seeded prompt — claude reads them
// with its Read tool (its cwd is the workspace).
const composeMessage = (message: string, attachments: Attachment[]): string => {
  if (attachments.length === 0) return message;
  const paths = attachments.map((file) => file.path).join("\n");
  return `${message}\n\nAttached file(s) — read them from the workspace:\n${paths}`;
};

// ── Deps-free command handlers (params + engine imports only) ──
// Extracted to module scope so createRemoteHostHandlers stays small; the deps-using
// handlers (workspace / spawnChat / ingest) stay in the factory below.

// Mirrors GET /api/collections/list → { collections: CollectionSummary[] }. Feeds
// (source "feed") are excluded — they are served by listFeeds.
const listCollections: CommandHandlers["listCollections"] = async () => {
  const collections = (await discoverCollections()).filter((collection) => collection.source !== "feed").map(toSummary);
  return { collections } as unknown as JsonObject;
};

// One collection's detail + a PAGE of its records (pagination mandatory — the result
// rides inside a 1 MiB Firestore command doc).
const getCollection: CommandHandlers["getCollection"] = async (params: JsonObject) => {
  const slug = String(params.slug ?? "");
  const offset = clampOffset(params.offset);
  const limit = clampLimit(params.limit);
  const collection = await loadCollection(slug);
  if (!collection) throw new Error(`collection '${slug}' not found`);
  const all = deriveItems(collection.schema, await listItems(collection.dataDir));
  return pageResult(toDetail(collection), all, offset, limit);
};

// One mobile custom view, wrapped host-side into its sandboxed srcdoc (CSP +
// postMessage bootstrap) — the phone renders the artifact verbatim.
const getRemoteView: CommandHandlers["getRemoteView"] = async (params: JsonObject) => {
  const slug = String(params.slug ?? "");
  const viewId = String(params.viewId ?? "");
  const locale = typeof params.locale === "string" ? params.locale : "";
  const collection = await loadCollection(slug);
  if (!collection) throw new Error(`collection '${slug}' not found`);
  const result = await buildRemoteView(collection, viewId, locale);
  if (result.kind !== "ok") throw new Error(remoteViewFailureMessage(result, slug));
  return { view: result.view, srcdoc: result.srcdoc, bytes: result.bytes } as unknown as JsonObject;
};

// One page of a mobile view's records, projected to the view's fields. Image fields are
// NOT inlined on this host yet (no thumbnail store) — they come back as workspace paths
// (unrenderable on the phone) and count as `omitted`.
const getRemoteViewItems: CommandHandlers["getRemoteViewItems"] = async (params: JsonObject) => {
  const slug = String(params.slug ?? "");
  const viewId = String(params.viewId ?? "");
  const request = { offset: clampOffset(params.offset), limit: clampLimit(params.limit), fields: normalizeFields(params.fields) };
  const collection = await loadCollection(slug);
  if (!collection) throw new Error(`collection '${slug}' not found`);
  const result = await remoteViewItems(collection, viewId, request);
  if (result.kind !== "ok") throw new Error(remoteViewItemsFailureMessage(result, slug));
  return { page: result.page, inlined: result.inlined, omitted: result.omitted } as unknown as JsonObject;
};

// Apply one update/delete requested by a writable mobile view, authorized by that view's
// declared surface (editableFields / allowDelete) and enforced HOST-side — the sandboxed
// view is never trusted.
const mutateRemoteViewItem: CommandHandlers["mutateRemoteViewItem"] = async (params: JsonObject) => {
  const slug = String(params.slug ?? "");
  const viewId = String(params.viewId ?? "");
  const request = normalizeMutate({ op: params.op, id: params.id, patch: params.patch });
  if (!request) throw new Error("invalid mutate request — expected { op: 'update'|'delete', id, patch? }");
  const collection = await loadCollection(slug);
  if (!collection) throw new Error(`collection '${slug}' not found`);
  const result = await mutateRemoteView(collection, viewId, request);
  if (result.kind !== "ok") throw new Error(mutateRemoteViewFailureMessage(result, slug));
  return (result.op === "delete" ? { op: "delete", id: result.id } : { op: "update", item: result.item }) as unknown as JsonObject;
};

// The phone's remote terminal view (#435): pick a session, read its screen, and —
// since #445 — type into it. Screens are bounded by the terminal's own geometry
// (rows x cols), so unlike collections they need no paging to stay under the 1 MiB
// command-doc ceiling.
type TerminalScreenDeps = Pick<RemoteHostHandlerDeps, "listTerminalSessions" | "captureTerminalScreen" | "writeToSession">;

const terminalScreenHandlers = ({ listTerminalSessions, captureTerminalScreen, writeToSession }: TerminalScreenDeps): CommandHandlers => {
  // One sender per host, so its per-session ordering actually spans every command.
  const sendInput = createTerminalInputSender({ writeToSession });
  return {
    listTerminalSessions: async () => ({ sessions: await listTerminalSessions() }) as unknown as JsonObject,

    getTerminalScreen: async (params: JsonObject) => {
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
      if (!sessionId) throw new Error("sessionId is required");
      return { screen: await captureTerminalScreen(sessionId) };
    },

    // Type a line into the session and press Enter, as if the user were at the
    // keyboard. The phone sends only text; the framing, sanitizing and Enter timing
    // are terminalInput.ts's job.
    sendTerminalInput: async (params: JsonObject) => {
      const sessionId = typeof params.sessionId === "string" ? params.sessionId : "";
      if (!sessionId) throw new Error("sessionId is required");
      const text = typeof params.text === "string" ? params.text : "";
      return (await sendInput(sessionId, text)) as unknown as JsonObject;
    },
  };
};

export function createRemoteHostHandlers(deps: RemoteHostHandlerDeps): CommandHandlers {
  const { workspace, spawnChat, ingest } = deps;

  return {
    listCollections,
    getCollection,
    getRemoteView,
    getRemoteViewItems,
    mutateRemoteViewItem,

    // Google Calendar, run host-side against the locally linked account. These
    // are advertised as capabilities unconditionally: linking is a host-machine
    // action (`mulmoterminal google login`), so a not-linked error is the only
    // way the phone can learn it needs to be run.
    "google.calendar.createEvent": googleCalendarCreateEvent,
    "google.calendar.listEvents": googleCalendarListEvents,
    // Non-primary calendars + colour palettes (core 0.23). listCalendars needs the
    // calendar-list read scope, so an existing link errors until the user re-authorizes.
    "google.calendar.listCalendars": googleCalendarListCalendars,
    "google.calendar.colors": googleCalendarColors,

    // Feed registry with retrieval kind / schedule / last-fetch time (read-only).
    listFeeds: async () => {
      const feeds = await listFeeds(workspace);
      const summaries = [];
      for (const feed of feeds) {
        const state = await readFeedState(workspace, feed);
        const { ingest } = feed.schema;
        summaries.push({
          slug: feed.slug,
          title: feed.schema.title,
          icon: feed.schema.icon,
          kind: ingest?.kind ?? "rss",
          schedule: ingest?.schedule ?? "on-demand",
          lastFetchedAt: state.lastFetchedAt,
        });
      }
      return { feeds: summaries } as unknown as JsonObject;
    },

    // One feed's detail + a PAGE of its records. A feed IS a LoadedCollection
    // with an `ingest` block, located via the feed registry (feeds live under
    // their own registry, not the collections dir), so this reuses the exact
    // collection page path and returns the SAME shape as getCollection — the
    // phone renders feed records with the same card view.
    getFeed: async (params: JsonObject) => {
      const slug = String(params.slug ?? "");
      const offset = clampOffset(params.offset);
      const limit = clampLimit(params.limit);
      const feed = (await listFeeds(workspace)).find((entry) => entry.slug === slug);
      if (!feed) throw new Error(`feed '${slug}' not found`);
      const all = deriveItems(feed.schema, await listItems(feed.dataDir));
      return pageResult(toDetail(feed), all, offset, limit);
    },

    // Pinned launcher shortcuts (favorites), read-only.
    listShortcuts: async () => ({ shortcuts: await readShortcuts(workspace) }) as unknown as JsonObject,

    // Discoverable skill ids (~/.claude/skills + <workspace>/.claude/skills),
    // read-only. Collection slugs are subtracted — a skill dir that ships a
    // schema.json is a collection served by listCollections, so it must not
    // double-list here (mirrors MulmoClaude's listSkills).
    listSkills: async () => {
      const [names, collections] = await Promise.all([discoverSkillNames({ workspaceRoot: workspace }), discoverCollections()]);
      const collectionSlugs = new Set(collections.filter((collection) => collection.source !== "feed").map((collection) => collection.slug));
      return { skills: names.filter((name) => !collectionSlugs.has(name)) } as unknown as JsonObject;
    },

    // { id, name } per accounting book, for a mobile book picker.
    listAccountingBooks: async () => {
      const { books } = await listBooks(workspace);
      return { books: books.map((book) => ({ id: book.id, name: book.name })) } as unknown as JsonObject;
    },

    // Start a visible chat from the phone, seeded with `message`. This host has
    // no roles, so a `role` param is ignored. Optional `attachments`
    // ([{ storage_id }]) are downloaded into the workspace and referenced by path
    // in the seeded prompt (the PTY claude reads them via its Read tool). Ingest
    // BEFORE spawning so a download failure rejects the command instead of
    // starting a chat missing its files.
    startChat: async (params: JsonObject) => {
      const message = (typeof params.message === "string" ? params.message : "").trim();
      if (!message) throw new Error("message is required");
      const attachments = await ingest(readStorageIds(params.attachments));
      const { chatId } = spawnChat(composeMessage(message, attachments));
      return { started: true, chatId };
    },

    ...terminalScreenHandlers(deps),
  };
}
