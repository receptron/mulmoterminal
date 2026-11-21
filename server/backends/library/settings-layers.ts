// Laying Claude Code's settings files over each other for one directory (#3332), as its documentation
// states (code.claude.com/docs/en/settings, "Settings precedence"): managed over local over project over
// user, a key in a stronger file overriding the same key below it, and a list adding to it. Pure: parsed
// files in, the result out — every value naming the file it came from.
import path from "node:path";
import { isRecord } from "../../../common/isRecord.js";
import { type FromSource, type LibrarySettings, type PermissionKind, type SettingsSource } from "../../../common/librarySettings.js";

/** Where an organization's managed settings file is, by system. */
export function managedSettingsFile(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode/managed-settings.json";
  if (platform === "win32") return "C:\\Program Files\\ClaudeCode\\managed-settings.json";
  return "/etc/claude-code/managed-settings.json";
}

/** The settings files Claude Code reads for a directory, weakest first. */
export function settingsFiles(cwd: string, configDir: string, platform: NodeJS.Platform): { source: SettingsSource; path: string }[] {
  const flavour = platform === "win32" ? path.win32 : path.posix;
  return [
    { source: "user", path: flavour.join(configDir, "settings.json") },
    { source: "project", path: flavour.join(cwd, ".claude", "settings.json") },
    { source: "local", path: flavour.join(cwd, ".claude", "settings.local.json") },
    { source: "managed", path: managedSettingsFile(platform) },
  ];
}

export interface ParsedSettings {
  source: SettingsSource;
  json: Record<string, unknown>;
}

/** The keys shown on their own, rather than among the others. */
const OWN_KEYS = new Set(["permissions", "env", "hooks", "$schema"]);

const stringsOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

/** The strongest file's value for each key, by the order given (weakest first). */
function strongest<T>(layers: readonly ParsedSettings[], entries: (json: Record<string, unknown>) => [string, T][]): Map<string, FromSource<T>> {
  const won = new Map<string, FromSource<T>>();
  layers.forEach(({ source, json }) => entries(json).forEach(([key, value]) => won.set(key, { value, source })));
  return won;
}

/** What a hook runs: its command, or its kind when it is not a command (a prompt, an agent). */
function hookCommand(hook: Record<string, unknown>): string {
  if (typeof hook.command === "string") return hook.command;
  return typeof hook.type === "string" ? hook.type : "";
}

/** Each hook event's entries as one line apiece: the matcher and the commands it runs. */
function hookLines(hooks: unknown): [string, string][] {
  if (!isRecord(hooks)) return [];
  return Object.entries(hooks).flatMap(([event, groups]) =>
    (Array.isArray(groups) ? groups : []).filter(isRecord).map((group): [string, string] => {
      const commands = (Array.isArray(group.hooks) ? group.hooks : []).filter(isRecord).map(hookCommand);
      const matcher = typeof group.matcher === "string" && group.matcher !== "" ? `${group.matcher}: ` : "";
      return [event, `${matcher}${commands.join(" ; ")}`];
    }),
  );
}

/** The files laid over each other, weakest first. */
export function layerSettings(cwd: string, layers: readonly ParsedSettings[]): Omit<LibrarySettings, "files"> {
  const rules = (kind: PermissionKind): FromSource<string>[] =>
    layers.flatMap(({ source, json }) => stringsOf(isRecord(json.permissions) ? json.permissions[kind] : undefined).map((value) => ({ value, source })));
  const permissions = { allow: rules("allow"), ask: rules("ask"), deny: rules("deny") };
  const env = strongest(layers, (json) =>
    isRecord(json.env) ? Object.entries(json.env).flatMap(([name, value]): [string, string][] => (typeof value === "string" ? [[name, value]] : [])) : [],
  );
  const other = strongest(layers, (json) =>
    Object.entries(json)
      .filter(([key]) => !OWN_KEYS.has(key))
      .map(([key, value]): [string, string] => [key, JSON.stringify(value)]),
  );
  return {
    cwd,
    permissions,
    env: [...env].map(([name, from]) => ({ name, ...from })),
    hooks: layers.flatMap(({ source, json }) => hookLines(json.hooks).map(([event, value]) => ({ event, value, source }))),
    other: [...other].map(([key, from]) => ({ key, ...from })),
  };
}
