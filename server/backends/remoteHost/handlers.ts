// Remote-host command handlers for MulmoTerminal.
//
// Each handler runs in-process on the host, so it bypasses the HTTP layer and
// calls the collection / feeds / accounting engines directly. The result shapes
// match MulmoClaude's handlers exactly, so one phone client (mulmoserver) drives
// either host.
//
// Phase 1 = read-only capabilities + a text startChat. Mobile custom views
// (getRemoteView / getRemoteViewItems / mutateRemoteViewItem) and chat image
// attachments (ingestAttachments) are deferred — see plans/feat-remote-host.md.
import { discoverCollections, listItems, loadCollection, toDetail, toSummary } from "@mulmoclaude/core/collection/server";
import { listFeeds, readFeedState } from "@mulmoclaude/core/feeds/server";
import { listBooks } from "@mulmoclaude/accounting-plugin/server";
import type { CommandHandlers, JsonObject } from "@mulmoclaude/core/remote-host";

import { readShortcuts } from "../shortcuts.js";
import { clampLimit, clampOffset, deriveItems, pageResult } from "./collectionPage.js";

export interface RemoteHostHandlerDeps {
  workspace: string;
  // Start a visible chat seeded with `message`; returns the new session id.
  spawnChat: (message: string) => { chatId: string };
}

export function createRemoteHostHandlers(deps: RemoteHostHandlerDeps): CommandHandlers {
  const { workspace, spawnChat } = deps;

  return {
    // Mirrors GET /api/collections/list → { collections: CollectionSummary[] }.
    // Feeds (source "feed") are excluded — they are served by listFeeds.
    listCollections: async () => {
      const collections = (await discoverCollections()).filter((collection) => collection.source !== "feed").map(toSummary);
      return { collections } as unknown as JsonObject;
    },

    // One collection's detail + a PAGE of its records (pagination mandatory — the
    // result rides inside a 1 MiB Firestore command doc).
    getCollection: async (params: JsonObject) => {
      const slug = String(params.slug ?? "");
      const offset = clampOffset(params.offset);
      const limit = clampLimit(params.limit);
      const collection = await loadCollection(slug);
      if (!collection) throw new Error(`collection '${slug}' not found`);
      const all = deriveItems(collection.schema, await listItems(collection.dataDir));
      return pageResult(toDetail(collection), all, offset, limit);
    },

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

    // Pinned launcher shortcuts (favorites), read-only.
    listShortcuts: async () => ({ shortcuts: await readShortcuts(workspace) }) as unknown as JsonObject,

    // { id, name } per accounting book, for a mobile book picker.
    listAccountingBooks: async () => {
      const { books } = await listBooks(workspace);
      return { books: books.map((book) => ({ id: book.id, name: book.name })) } as unknown as JsonObject;
    },

    // Start a visible chat from the phone, seeded verbatim with `message`. This
    // host has no roles, so a `role` param is ignored. Attachments are not
    // supported yet — reject rather than silently drop them (the remote already
    // uploaded the bytes and would otherwise get a chat missing its files).
    startChat: async (params: JsonObject) => {
      const message = (typeof params.message === "string" ? params.message : "").trim();
      if (!message) throw new Error("message is required");
      if (Array.isArray(params.attachments) && params.attachments.length > 0) {
        throw new Error("attachments are not supported on this host yet");
      }
      const { chatId } = spawnChat(message);
      return { started: true, chatId };
    },
  };
}
