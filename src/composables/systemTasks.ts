import { createGlobalFlag } from "./globalFlag";

// The two built-in scheduled tasks that are otherwise always on: the hourly collection/feed
// refresh and the hourly Google Calendar sync (#2015).
//
// `true`, not `false`, is the default on BOTH — they are existing behaviour, so a config file
// written before this must keep them running. Mirrors `sanitizeFeedRefreshEnabled` /
// `sanitizeCalendarSyncEnabled` on the server, which only an explicit `false` turns off.
//
// One module for two keys because they are one decision to the reader: someone opening this
// section is asking "which of the built-in tasks do I want", not about either one alone.
const feedRefresh = createGlobalFlag("feedRefreshEnabled", true);
const calendarSync = createGlobalFlag("calendarSyncEnabled", true);

export const feedRefreshEnabled = feedRefresh.state;
export const setFeedRefreshEnabled = feedRefresh.set;
export const saveFeedRefreshEnabled = feedRefresh.save;

export const calendarSyncEnabled = calendarSync.state;
export const setCalendarSyncEnabled = calendarSync.set;
export const saveCalendarSyncEnabled = calendarSync.save;
