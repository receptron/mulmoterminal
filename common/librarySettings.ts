// What the Library's tools kind shows of Claude Code's settings for one directory (#3332): each file it
// reads, and the result of laying them over each other, every value naming the file it came from.
// Shared by the route and the view.
import { isRecord } from "./isRecord.js";

/** The settings files, weakest first: a key in a later one overrides the same key in an earlier one, and
 *  a list adds to it (code.claude.com/docs/en/settings, "Settings precedence"). */
export const SETTINGS_SOURCES = ["user", "project", "local", "managed"] as const;
export type SettingsSource = (typeof SETTINGS_SOURCES)[number];

export const PERMISSION_KINDS = ["allow", "ask", "deny"] as const;
export type PermissionKind = (typeof PERMISSION_KINDS)[number];

export interface SettingsFile {
  source: SettingsSource;
  path: string;
  /** "absent": no such file; "invalid": not a JSON object, so Claude Code skips it. */
  state: "ok" | "absent" | "invalid";
}

export interface FromSource<T> {
  value: T;
  source: SettingsSource;
}

export interface LibrarySettings {
  cwd: string;
  files: SettingsFile[];
  /** Every rule of each kind, from every file: the lists merge. */
  permissions: Record<PermissionKind, FromSource<string>[]>;
  /** Each variable's value from the strongest file that sets it. */
  env: (FromSource<string> & { name: string })[];
  /** Each hook event's entries, from every file. */
  hooks: (FromSource<string> & { event: string })[];
  /** Every other top-level key, from the strongest file that sets it, as JSON. */
  other: (FromSource<string> & { key: string })[];
}

const isSource = (value: unknown): value is SettingsSource => SETTINGS_SOURCES.some((source) => source === value);
const isFrom = (value: unknown, extra: string | null = null): boolean =>
  isRecord(value) && typeof value.value === "string" && isSource(value.source) && (extra === null || typeof value[extra] === "string");
const isFile = (value: unknown): value is SettingsFile =>
  isRecord(value) &&
  isSource(value.source) &&
  typeof value.path === "string" &&
  (value.state === "ok" || value.state === "absent" || value.state === "invalid");

const listOf = (value: unknown, extra: string | null): boolean => Array.isArray(value) && value.every((entry) => isFrom(entry, extra));

const isPermissions = (value: unknown): value is LibrarySettings["permissions"] =>
  isRecord(value) && PERMISSION_KINDS.every((kind) => listOf(value[kind], null));

export const isLibrarySettings = (value: unknown): value is LibrarySettings =>
  isRecord(value) &&
  typeof value.cwd === "string" &&
  Array.isArray(value.files) &&
  value.files.every(isFile) &&
  isPermissions(value.permissions) &&
  listOf(value.env, "name") &&
  listOf(value.hooks, "event") &&
  listOf(value.other, "key");
