// What the Settings sidebar offers: one tab per section, under the group it belongs to (#1563).
//
// Ids only — the words are `settings.groups.<key>` and `settings.tabs.<id>` in src/i18n, derived
// from these ids the way MulmoClaude derives its own. A section renders no heading of its own
// either: the sidebar entry and the pane heading are one message, and two copies of a string is how
// one of them ends up saying something the other doesn't (#1097).
//
// Group order, and the order within each group, are expected access frequency — the same rule
// MulmoClaude's own GROUPS table states for the sidebar this one follows.

export type SettingsTabId =
  | "language"
  | "theme"
  | "font"
  | "fontSize"
  | "scroll"
  | "waitingRows"
  | "gridHeader"
  | "toolbarPins"
  | "dirAppearance"
  | "dirSettings"
  | "launchers"
  | "headerChrome"
  | "terminalKeys"
  | "shortcuts"
  | "voice"
  | "models"
  | "mcp"
  | "sounds"
  | "push"
  | "quickCommands"
  | "github"
  | "prRepos"
  | "google"
  | "sessions"
  | "surviving"
  | "cost"
  | "quit"
  | "help";

export interface SettingsGroup {
  key: string;
  tabs: readonly SettingsTabId[];
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  // Language leads the whole sidebar on purpose: it is the one setting someone who cannot read the
  // rest of the screen has to find first.
  { key: "appearance", tabs: ["language", "theme", "font", "fontSize", "scroll", "waitingRows", "gridHeader", "toolbarPins"] },
  { key: "projects", tabs: ["dirAppearance", "dirSettings"] },
  { key: "launch", tabs: ["launchers", "headerChrome"] },
  { key: "input", tabs: ["terminalKeys", "shortcuts", "voice"] },
  { key: "models", tabs: ["models", "mcp"] },
  { key: "notifications", tabs: ["sounds", "push", "quickCommands"] },
  { key: "integrations", tabs: ["github", "prRepos", "google"] },
  { key: "sessions", tabs: ["sessions", "surviving", "cost", "quit"] },
  { key: "help", tabs: ["help"] },
];

export const SETTINGS_TABS: readonly SettingsTabId[] = SETTINGS_GROUPS.flatMap((group) => group.tabs);

// Where the modal opens. A choice, not "whatever sorts first": Theme is the setting most people
// come here for and the cheapest pane to render.
export const DEFAULT_SETTINGS_TAB: SettingsTabId = "theme";

export const isSettingsTabId = (value: string): value is SettingsTabId => SETTINGS_TABS.some((tab) => tab === value);
