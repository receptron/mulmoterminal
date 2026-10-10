// Command-handler table for MulmoTerminal's remote host — the single place the runner learns
// which methods it serves. Add a capability by importing its handler and adding it here.
//
// A FACTORY rather than MulmoClaude's static `handlers` const: this host's deps (workspace, chat
// spawner, attachment ingester, PTY accessors) are wired in server/index.ts. See ./deps.ts.
//
// ── DOCS ──────────────────────────────────────────────────────────────────────
// The command surface and its wire shapes are documented for the phone's authors
// in docs/remote-host-protocol.md. Add or change a command and update it in the
// same commit, then file the matching issue on receptron/mulmoserver — the phone
// ignores a field it was never taught about, so a host-only change ships as
// silence rather than as a feature.
// ──────────────────────────────────────────────────────────────────────────────
import type { CommandHandlers } from "@mulmoclaude/core/remote-host";
import { googleCalendarColors, googleCalendarCreateEvent, googleCalendarListCalendars, googleCalendarListEvents } from "../googleCalendar.js";
import { getCollection } from "./getCollection.js";
import { getFeedFor } from "./getFeed.js";
import { getRemoteView } from "./getRemoteView.js";
import { createIssueWorkHandlers } from "./issueWork.js";
import { getRemoteViewItems } from "./getRemoteViewItems.js";
import { createListAccountingBooks } from "./listAccountingBooks.js";
import { listCollectionProjects } from "./listCollectionProjects.js";
import { listCollections } from "./listCollections.js";
import { createListFeeds } from "./listFeeds.js";
import { createListShortcuts } from "./listShortcuts.js";
import { createListSkills } from "./listSkills.js";
import { createMobileFileHandlers } from "./mobileFiles.js";
import { mutateRemoteViewItem } from "./mutateRemoteView.js";
import { createPastSessionHandlers } from "./pastSessions.js";
import { createStartChat } from "./startChat.js";
import { createTerminalSessionHandlers } from "./terminalSession.js";
import type { RemoteHostHandlerDeps } from "./deps.js";

export type { RemoteHostHandlerDeps } from "./deps.js";

export function createRemoteHostHandlers(deps: RemoteHostHandlerDeps): CommandHandlers {
  const { workspace } = deps;

  return {
    listCollections,
    // How the phone LEARNS which projects it may name — the other half of the scope the
    // collection handlers already resolve (../commandScope.ts).
    listCollectionProjects,
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

    listFeeds: createListFeeds(workspace),
    getFeed: getFeedFor(workspace),
    listShortcuts: createListShortcuts(workspace),
    listSkills: createListSkills(workspace),
    listAccountingBooks: createListAccountingBooks(workspace),
    startChat: createStartChat(deps),

    // Starting work on a GitHub issue from the phone (#1184). Reads the configured repos, and
    // starts in the clone recorded for one — never in a directory the phone named.
    ...createIssueWorkHandlers(deps),

    ...createTerminalSessionHandlers(deps),
    // Earlier sessions of an open terminal's directory, read as conversations (#2999).
    ...createPastSessionHandlers(deps),

    // Files a project declares under `mobileFiles` in its .mulmoterminal.json (#2911).
    ...createMobileFileHandlers({ workspace, stager: deps.mobileFileStager }),
  };
}
