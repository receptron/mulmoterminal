// google.calendar.* command handlers (remote-host).
//
// The phone triggers these over the command channel, but the Calendar call runs
// here on the host with the locally stored OAuth token — no Google credential
// ever reaches the cloud. The deps factory keeps validation + mapping testable
// with the Calendar engine stubbed; the default handlers wire the real ones.
//
// Param names and result shapes mirror MulmoClaude's handlers exactly, so one
// phone client drives either host.
import {
  createCalendarEvent,
  DEFAULT_LIST_MAX_RESULTS,
  getGoogleAccessToken,
  isIsoDateTimeWithOffset,
  listCalendarEvents,
  MAX_LIST_RESULTS,
} from "@mulmoclaude/core/google";
import type { CommandHandler, JsonObject } from "@mulmoclaude/core/remote-host";

export interface GoogleCalendarDeps {
  getAccessToken: typeof getGoogleAccessToken;
  createEvent: typeof createCalendarEvent;
  listEvents: typeof listCalendarEvents;
}

const MIN_LIST_RESULTS = 1;
const DATE_TIME_HINT = "must be an ISO 8601 date-time with a timezone offset (e.g. 2026-07-17T09:00:00+09:00)";

const requiredString = (params: JsonObject, key: string): string => {
  const value = params[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} must be a non-empty string`);
  return value;
};

// Calendar rejects date-only or offset-less values with an opaque 400, so the
// offset is enforced here where the remote still gets an actionable message.
const asDateTime = (value: string, key: string): string => {
  if (!isIsoDateTimeWithOffset(value)) throw new Error(`${key} ${DATE_TIME_HINT}`);
  return value;
};

const optionalDateTime = (params: JsonObject, key: string): string | undefined => {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${key} ${DATE_TIME_HINT}`);
  return asDateTime(value, key);
};

const clampMaxResults = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) return DEFAULT_LIST_MAX_RESULTS;
  return Math.min(Math.max(value, MIN_LIST_RESULTS), MAX_LIST_RESULTS);
};

export const createGoogleCalendarCreateEvent =
  (deps: GoogleCalendarDeps): CommandHandler =>
  async (params: JsonObject) => {
    const input = {
      summary: requiredString(params, "summary"),
      startDateTime: asDateTime(requiredString(params, "start"), "start"),
      endDateTime: asDateTime(requiredString(params, "end"), "end"),
      description: typeof params.description === "string" ? params.description : undefined,
    };
    const event = await deps.createEvent(await deps.getAccessToken(), input);
    // Spread rebuilds an anonymous object type — CalendarEventSummary has no
    // index signature, so it can't satisfy the channel's structural JsonValue.
    return { event: { ...event } };
  };

export const createGoogleCalendarListEvents =
  (deps: GoogleCalendarDeps): CommandHandler =>
  async (params: JsonObject) => {
    const timeMin = optionalDateTime(params, "timeMin");
    const maxResults = clampMaxResults(params.maxResults);
    const events = await deps.listEvents(await deps.getAccessToken(), { timeMin, maxResults });
    return { events: events.map((event) => ({ ...event })) };
  };

const liveDeps: GoogleCalendarDeps = { getAccessToken: getGoogleAccessToken, createEvent: createCalendarEvent, listEvents: listCalendarEvents };
export const googleCalendarCreateEvent = createGoogleCalendarCreateEvent(liveDeps);
export const googleCalendarListEvents = createGoogleCalendarListEvents(liveDeps);
