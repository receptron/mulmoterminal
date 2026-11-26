// What the command palette lists (#2266), with no DOM, no i18n instance and no state of its own —
// every input is a parameter, so every rule below is a spec.
import {
  KEYMAP_ACTIONS,
  NEEDS_A_CURRENT_TERMINAL,
  NEEDS_FILES_PANE,
  NEEDS_MANUAL_ORDER,
  NEEDS_NOTHING_ENLARGED,
  TERMINAL_SCOPED_ACTIONS,
  type Keymap,
  type KeymapAction,
} from "../../common/keymap";
import { isFilesScreenAction } from "../components/filesPaneActions";
import { LISTED_ELSEWHERE_IN_PALETTE } from "../../common/appActions";
import { highlightParts, rankPaths, type HighlightPart } from "../components/filePathMatch";
import { SCREEN_ICONS, type PaletteScreen } from "./paletteScreens";
import type { PaletteTerminal } from "./commandPalette";
import type { SettingsTabId } from "../components/settings/settingsTabs";
import type { PaletteChoice } from "./paletteChoices";
import type { PaletteCommand } from "./paletteCommandList";
import type { PaletteCollectionAction } from "./paletteCollectionActionList";
import type { PaletteLaunchDir } from "./paletteLaunchDirs";
import { paletteStartId, type PaletteStart } from "./paletteStarts";
import { paletteResumeId, type PaletteResume } from "./paletteResumes";
import { closedCellId, type ClosedCell } from "./recentlyClosed";
import type { PaletteWikiPage } from "./paletteWikiPages";
import { paletteGithubItemId, type PaletteGithubItem } from "./paletteGithubItems";
import { promptFirstLine, type PalettePrompt } from "./palettePrompts";
import { isRemembered } from "./paletteFrecency";
import { aliasTarget, aliasesByKey, pinRows } from "./paletteShortcuts";
import type { PaletteAliases } from "../../common/paletteConfig";
import type { SeededFilesPanel } from "./filesPanelSeed";
import { PALETTE_SCOPES, scopeOf, type ScopedKind } from "./paletteScope";
import { isMenuRow, menuCandidates, menuRow, menuRowKey, type MenuCandidate, type ScriptRow, type SkillRow } from "./paletteMenuRows";
import type { DiscoveredSkill, RunnableScript } from "./useDirLists";

/** The actions a palette can run. Not `copy` / `paste` — they act on a terminal's selection, from
 *  inside it — not the palette itself, and not the toolbar's operations it already lists as screens,
 *  Settings sections and choices. */
export const PALETTE_ACTIONS: readonly KeymapAction[] = KEYMAP_ACTIONS.filter(
  (action) => !TERMINAL_SCOPED_ACTIONS.includes(action) && action !== "command-palette" && !LISTED_ELSEWHERE_IN_PALETTE.includes(action),
);

interface RowCommon {
  /** The row's name, split into the runs the query matched. */
  label: HighlightPart[];
  description: string;
  /** Why it cannot run right now, or null when it can. */
  disabledReason: string | null;
}

/** A grid action, run by the grid. */
export interface ActionRow extends RowCommon {
  kind: "action";
  action: KeymapAction;
  /** The user's binding as they wrote it, or null when the action has none. */
  binding: string | null;
}

/** A screen to go to (#2441). It needs no grid, so it is never disabled. */
export interface ScreenRow extends RowCommon {
  kind: "screen";
  screen: PaletteScreen;
  icon: string;
}

/** One of the grid's terminals, found by its path (#2446). Going to it needs no grid in front. */
export interface TerminalRow extends RowCommon {
  kind: "terminal";
  uid: number;
  icon: string;
}

/** A Settings section, opened in Settings (#2450). */
export interface SettingsRow extends RowCommon {
  kind: "settings";
  tab: SettingsTabId;
  icon: string;
}

/** A setting switched in place (#2455): a theme, a language, the sound. */
export interface ChoiceRow extends RowCommon {
  kind: "choice";
  id: string;
  icon: string;
}

/** A leading symbol offered by `?` (#2462): picking it narrows the search rather than running. */
export interface PrefixRow extends RowCommon {
  kind: "prefix";
  symbol: string;
  icon: string;
}

/** A header button or a palette command of the terminal commands act on (#2465). */
export interface CommandRow extends RowCommon {
  kind: "command";
  id: string;
  icon: string;
}

/** A collection's collection-level action (#2471). */
export interface CollectionRow extends RowCommon {
  kind: "collection";
  slug: string;
  id: string;
  icon: string;
}

/** An agent or a launcher to start in the acting terminal's directory (#2487). */
export interface StartRow extends RowCommon {
  kind: "start";
  start: PaletteStart;
  icon: string;
}

/** The Files pane's finder or search, opened on what was typed after `/` or `#`. */
export interface HandoffRow extends RowCommon {
  kind: "handoff";
  action: SeededFilesPanel;
  query: string;
  icon: string;
}

/** An open PR or Issue of a configured repo, opened on GitHub (#2517). */
export interface GithubRow extends RowCommon {
  kind: "github";
  item: PaletteGithubItem;
  icon: string;
}

/** A past prompt of the acting terminal, put back at its input (#2523). */
export interface PromptRow extends RowCommon {
  kind: "prompt";
  prompt: PalettePrompt;
  icon: string;
}

/** A Wiki page to open (#2503). */
export interface WikiRow extends RowCommon {
  kind: "wiki";
  slug: string;
  icon: string;
}

/** A past conversation of the acting directory to resume (#2498). */
export interface ResumeRow extends RowCommon {
  kind: "resume";
  resume: PaletteResume;
  icon: string;
}

/** A cell closed recently, to open again (#2800). */
export interface ReopenRow extends RowCommon {
  kind: "reopen";
  closed: ClosedCell;
  icon: string;
}

/** A directory to open a new terminal in (#2484). */
export interface LaunchRow extends RowCommon {
  kind: "launch";
  path: string;
  icon: string;
}

export type PaletteRow =
  | ActionRow
  | ScreenRow
  | TerminalRow
  | SettingsRow
  | ChoiceRow
  | PrefixRow
  | CommandRow
  | CollectionRow
  | LaunchRow
  | StartRow
  | ResumeRow
  | ReopenRow
  | WikiRow
  | HandoffRow
  | GithubRow
  | PromptRow
  | ScriptRow
  | SkillRow;

const LAUNCH_ICON = "add_box";

const RESUME_ICON = "history";

const REOPEN_ICON = "undo";

const PROMPT_ICON = "chat";

const WIKI_ICON = "article";

const SETTINGS_ICON = "settings";

/** What the palette can list beside the grid's actions. */
export interface PaletteSources {
  screens: readonly PaletteScreen[];
  terminals: readonly PaletteTerminal[];
  settings: readonly SettingsTabId[];
  choices: readonly PaletteChoice[];
  commands: readonly PaletteCommand[];
  collectionActions: readonly PaletteCollectionAction[];
  launchDirs: readonly PaletteLaunchDir[];
  starts: readonly PaletteStart[];
  /** Where a start runs, as it reads; null lists no starts. */
  startDir: string | null;
  resumes: readonly PaletteResume[];
  /** The cells closed recently, newest first, less any the grid has open again. */
  closedCells: readonly ClosedCell[];
  wikiPages: readonly PaletteWikiPage[];
  githubItems: readonly PaletteGithubItem[];
  prompts: readonly PalettePrompt[];
  /** The acting terminal's Run-menu scripts and Skill-menu skills (#2697); empty where it has no menus. */
  scripts: readonly RunnableScript[];
  skills: readonly DiscoveredSkill[];
  /** How much each row (by its key) has been used, for breaking ties; 0 for a row never picked. */
  frecency: (key: string) => number;
  /** The config file's `paletteAliases` and `paletteFavorites` (#2540). */
  aliases: PaletteAliases;
  favorites: readonly string[];
  /** The grid holds as many terminals as it can: a new one would place nothing. */
  gridFull: boolean;
}

const TERMINAL_ICON = "terminal";

/** A past conversation to resume, or a closed cell to reopen: the rows that bring a session back. */
const isConversationRow = (row: PaletteRow): row is ResumeRow | ReopenRow => row.kind === "resume" || row.kind === "reopen";
const conversationRowKey = (row: ResumeRow | ReopenRow): string =>
  row.kind === "resume" ? `resume:${paletteResumeId(row.resume)}` : `reopen:${closedCellId(row.closed)}`;

/** A key that tells the rows apart across kinds, for `v-for` and tests. */
export const rowKey = (row: PaletteRow): string => {
  if (row.kind === "action") return row.action;
  if (row.kind === "settings") return `settings:${row.tab}`;
  if (row.kind === "choice") return `choice:${row.id}`;
  if (row.kind === "prefix") return `prefix:${row.symbol}`;
  if (row.kind === "command") return `command:${row.id}`;
  if (row.kind === "collection") return `collection:${row.slug}:${row.id}`;
  if (row.kind === "launch") return `launch:${row.path}`;
  if (row.kind === "start") return `start:${paletteStartId(row.start)}`;
  if (row.kind === "wiki") return `wiki:${row.slug}`;
  if (row.kind === "prompt") return `prompt:${row.prompt.index}`;
  if (row.kind === "github") return `github:${paletteGithubItemId(row.item)}`;
  if (row.kind === "handoff") return `handoff:${row.action}`;
  if (isConversationRow(row)) return conversationRowKey(row);
  if (isMenuRow(row)) return menuRowKey(row);
  return row.kind === "screen" ? `screen:${row.screen}` : `terminal:${row.uid}`;
};

export interface PaletteText {
  label: (action: KeymapAction) => string;
  description: (action: KeymapAction) => string;
  needsEnlarged: string;
  needsNothingEnlarged: string;
  needsManualOrder: string;
  needsFilesPane: string;
  gridHidden: string;
  screenLabel: (screen: PaletteScreen) => string;
  screenDescription: (screen: PaletteScreen) => string;
  settingsLabel: (tab: SettingsTabId) => string;
  openInSettings: string;
  fromCollection: string;
  newTerminalIn: (dir: string) => string;
  launchDetail: string;
  startAgent: (agent: string) => string;
  runLauncher: (label: string) => string;
  startDetail: (dir: string) => string;
  resumeLabel: (title: string) => string;
  wikiPage: (title: string) => string;
  wikiDetail: string;
  promptLabel: (firstLine: string) => string;
  promptDetail: string;
  githubItem: (kind: PaletteGithubItem["kind"], number: number, title: string) => string;
  handoff: (action: SeededFilesPanel, query: string) => string;
  resumeDetail: (resume: PaletteResume) => string;
  reopenLabel: (title: string) => string;
  reopenDetail: (closed: ClosedCell) => string;
  gridFull: string;
  currentChoice: string;
  switchChoice: string;
  scopeLabel: (kind: ScopedKind) => string;
  runScript: (label: string) => string;
  runSkill: (slug: string) => string;
}

/** The grid's state, as far as the rows care. */
export interface PaletteState {
  zoomed: boolean;
  /** Whether the grid is in front and taking keys; false over another view or the launch panel. */
  available: boolean;
  manualOrder: boolean;
  /** Whether the grid's Files pane is up, which its tab actions act on. */
  filesOpen: boolean;
  /** Whether the full-screen Files view is up, which takes the Files actions itself (#2655). */
  filesScreen?: boolean;
}

const disabledReason = (action: KeymapAction, { zoomed, available, manualOrder, filesOpen, filesScreen }: PaletteState, text: PaletteText): string | null => {
  if (filesScreen && isFilesScreenAction(action)) return null;
  if (!available) return text.gridHidden;
  if (NEEDS_MANUAL_ORDER.includes(action) && !manualOrder) return text.needsManualOrder;
  if (NEEDS_A_CURRENT_TERMINAL.includes(action) && !zoomed) return text.needsEnlarged;
  if (NEEDS_NOTHING_ENLARGED.includes(action) && zoomed) return text.needsNothingEnlarged;
  if (NEEDS_FILES_PANE.includes(action) && !filesOpen) return text.needsFilesPane;
  return null;
};

type Candidate =
  | { kind: "action"; action: KeymapAction; name: string }
  | { kind: "screen"; screen: PaletteScreen; name: string }
  | { kind: "terminal"; terminal: PaletteTerminal; name: string }
  | { kind: "settings"; tab: SettingsTabId; name: string }
  | { kind: "choice"; choice: PaletteChoice; name: string }
  | { kind: "command"; command: PaletteCommand; name: string }
  | { kind: "collection"; action: PaletteCollectionAction; name: string }
  | { kind: "launch"; dir: PaletteLaunchDir; name: string; full: boolean }
  | { kind: "start"; start: PaletteStart; dir: string; name: string; full: boolean }
  | { kind: "resume"; resume: PaletteResume; name: string; full: boolean }
  | { kind: "reopen"; closed: ClosedCell; name: string; full: boolean }
  | { kind: "wiki"; page: PaletteWikiPage; name: string }
  | { kind: "github"; item: PaletteGithubItem; name: string }
  | { kind: "prompt"; prompt: PalettePrompt; name: string }
  | MenuCandidate;

/** What starts a terminal: an agent or a launcher here, a past conversation, a new terminal elsewhere. */
function startCandidates({ launchDirs, starts, startDir, resumes, closedCells, gridFull }: PaletteSources, text: PaletteText): [string, Candidate][] {
  const startsHere = (startDir === null ? [] : starts).map((start): [string, Candidate] => {
    const name = startName(start, text);
    return [`${name} ${paletteStartId(start)}`, { kind: "start", start, dir: startDir ?? "", name, full: gridFull }];
  });
  const resumesHere = resumes.map((resume): [string, Candidate] => {
    const name = text.resumeLabel(resume.title);
    return [`${name} ${paletteResumeId(resume)}`, { kind: "resume", resume, name, full: gridFull }];
  });
  const reopens = closedCells.map((closed): [string, Candidate] => {
    const name = text.reopenLabel(closed.remoteHost === undefined ? closed.title : `${closed.title} (${closed.remoteHost})`);
    return [`${name} ${closed.cwd ?? ""} ${closedCellId(closed)}`, { kind: "reopen", closed, name, full: gridFull }];
  });
  const newTerminals = launchDirs.map((dir): [string, Candidate] => [
    `${text.newTerminalIn(dir.label)} ${dir.path}`,
    { kind: "launch", dir, name: text.newTerminalIn(dir.label), full: gridFull },
  ]);
  return [...startsHere, ...resumesHere, ...reopens, ...newTerminals];
}

/** What the palette jumps into: a Wiki page, a PR or an Issue. */
function contentCandidates({ wikiPages, githubItems, prompts }: PaletteSources, text: PaletteText): [string, Candidate][] {
  const pages = wikiPages.map((page): [string, Candidate] => {
    const name = text.wikiPage(page.title);
    return [`${name} ${page.keywords}`, { kind: "wiki", page, name }];
  });
  const githubRows = githubItems.map((item): [string, Candidate] => {
    const name = text.githubItem(item.kind, item.number, item.title);
    return [`${name} ${paletteGithubItemId(item)}`, { kind: "github", item, name }];
  });
  // The whole prompt is searched, since the part remembered is rarely its first line.
  const promptRows = prompts.map((prompt): [string, Candidate] => {
    const name = text.promptLabel(promptFirstLine(prompt.text));
    return [`${name} ${prompt.text} #${prompt.index}`, { kind: "prompt", prompt, name }];
  });
  return [...pages, ...githubRows, ...promptRows];
}

// While the grid is in front its actions are what the palette is for; anywhere else only the
// screens can run, so they lead the unfiltered list.
function candidatesFor(sources: PaletteSources, state: PaletteState, text: PaletteText): Map<string, Candidate> {
  const { screens, terminals, settings, choices, commands, collectionActions } = sources;
  const actions = PALETTE_ACTIONS.map((action): [string, Candidate] => [
    `${text.label(action)} ${action}`,
    { kind: "action", action, name: text.label(action) },
  ]);
  const places = screens.map((screen): [string, Candidate] => [
    `${text.screenLabel(screen)} ${screen}`,
    { kind: "screen", screen, name: text.screenLabel(screen) },
  ]);
  // Two terminals can share a directory, so the uid keeps each candidate its own; it trails the
  // text anyone would type.
  const cells = terminals.map((terminal): [string, Candidate] => [
    `${terminal.path} ${terminal.keywords} #${terminal.uid}`,
    { kind: "terminal", terminal, name: terminal.path },
  ]);
  const sections = settings.map((tab): [string, Candidate] => [`${text.settingsLabel(tab)} ${tab}`, { kind: "settings", tab, name: text.settingsLabel(tab) }]);
  const switches = choices.map((choice): [string, Candidate] => [`${choice.label} ${choice.id}`, { kind: "choice", choice, name: choice.label }]);
  // A command belongs to the terminal it acts on, so it sits beside the grid's own actions.
  const runs: [string, Candidate][] = [
    ...commands.map((command): [string, Candidate] => [`${command.label} ${command.id}`, { kind: "command", command, name: command.label }]),
    ...menuCandidates(sources.scripts, sources.skills, text),
  ];
  // Two collections can name an action alike, so the slug keeps each candidate its own.
  const collectionRuns = collectionActions.map((action): [string, Candidate] => [
    `${action.label} ${action.slug}/${action.id}`,
    { kind: "collection", action, name: action.label },
  ]);
  const starting = startCandidates(sources, text);
  const content = contentCandidates(sources, text);
  return new Map(
    state.available
      ? [...actions, ...runs, ...collectionRuns, ...cells, ...starting, ...places, ...content, ...sections, ...switches]
      : [...places, ...content, ...cells, ...starting, ...runs, ...collectionRuns, ...sections, ...switches, ...actions],
  );
}

const startName = (start: PaletteStart, text: PaletteText): string => (start.kind === "agent" ? text.startAgent(start.label) : text.runLauncher(start.label));

const START_ICONS: Record<PaletteStart["kind"], string> = { agent: "smart_toy", launcher: "rocket_launch" };

function launchRow({ dir, full }: Extract<Candidate, { kind: "launch" }>, label: HighlightPart[], text: PaletteText): LaunchRow {
  return { kind: "launch", path: dir.path, icon: LAUNCH_ICON, label, description: text.launchDetail, disabledReason: full ? text.gridFull : null };
}

const GITHUB_ICONS: Record<PaletteGithubItem["kind"], string> = { pr: "github:git-pull-request", issue: "github:issue-opened" };

function githubRow({ item }: Extract<Candidate, { kind: "github" }>, label: HighlightPart[]): GithubRow {
  return { kind: "github", item, icon: GITHUB_ICONS[item.kind], label, description: item.repo, disabledReason: null };
}

function wikiRow({ page }: Extract<Candidate, { kind: "wiki" }>, label: HighlightPart[], text: PaletteText): WikiRow {
  return { kind: "wiki", slug: page.slug, icon: WIKI_ICON, label, description: page.description || text.wikiDetail, disabledReason: null };
}

function resumeRow({ resume, full }: Extract<Candidate, { kind: "resume" }>, label: HighlightPart[], text: PaletteText): ResumeRow {
  return { kind: "resume", resume, icon: RESUME_ICON, label, description: text.resumeDetail(resume), disabledReason: full ? text.gridFull : null };
}

function reopenRow({ closed, full }: Extract<Candidate, { kind: "reopen" }>, label: HighlightPart[], text: PaletteText): ReopenRow {
  return { kind: "reopen", closed, icon: REOPEN_ICON, label, description: text.reopenDetail(closed), disabledReason: full ? text.gridFull : null };
}

type ConversationCandidate = Extract<Candidate, { kind: "resume" | "reopen" }>;
const isConversationCandidate = (candidate: Candidate): candidate is ConversationCandidate => candidate.kind === "resume" || candidate.kind === "reopen";
const conversationRow = (candidate: ConversationCandidate, label: HighlightPart[], text: PaletteText): ResumeRow | ReopenRow =>
  candidate.kind === "resume" ? resumeRow(candidate, label, text) : reopenRow(candidate, label, text);

function startRow({ start, dir, full }: Extract<Candidate, { kind: "start" }>, label: HighlightPart[], text: PaletteText): StartRow {
  const disabledReason = full ? text.gridFull : null;
  return { kind: "start", start, icon: START_ICONS[start.kind], label, description: text.startDetail(dir), disabledReason };
}

function rowOf(candidate: Candidate, indexes: number[], keymap: Keymap, state: PaletteState, text: PaletteText): PaletteRow {
  const label = highlightParts(
    candidate.name,
    indexes.filter((index) => index < candidate.name.length),
  );
  if (candidate.kind === "script" || candidate.kind === "skill") return menuRow(candidate, label);
  if (candidate.kind === "start") return startRow(candidate, label, text);
  if (isConversationCandidate(candidate)) return conversationRow(candidate, label, text);
  if (candidate.kind === "wiki") return wikiRow(candidate, label, text);
  if (candidate.kind === "github") return githubRow(candidate, label);
  if (candidate.kind === "prompt")
    return { kind: "prompt", prompt: candidate.prompt, icon: PROMPT_ICON, label, description: text.promptDetail, disabledReason: null };
  if (candidate.kind === "launch") return launchRow(candidate, label, text);
  if (candidate.kind === "collection") {
    const { action } = candidate;
    return { kind: "collection", slug: action.slug, id: action.id, icon: action.icon, label, description: text.fromCollection, disabledReason: null };
  }
  if (candidate.kind === "command") {
    const { command } = candidate;
    return { kind: "command", id: command.id, icon: command.icon, label, description: command.detail, disabledReason: null };
  }
  if (candidate.kind === "choice") {
    const { choice } = candidate;
    return {
      kind: "choice",
      id: choice.id,
      icon: choice.icon,
      label,
      description: choice.current ? text.currentChoice : text.switchChoice,
      disabledReason: null,
    };
  }
  if (candidate.kind === "settings") {
    return { kind: "settings", tab: candidate.tab, icon: SETTINGS_ICON, label, description: text.openInSettings, disabledReason: null };
  }
  if (candidate.kind === "terminal") {
    return { kind: "terminal", uid: candidate.terminal.uid, icon: TERMINAL_ICON, label, description: candidate.terminal.detail, disabledReason: null };
  }
  if (candidate.kind === "screen") {
    return {
      kind: "screen",
      screen: candidate.screen,
      icon: SCREEN_ICONS[candidate.screen],
      label,
      description: text.screenDescription(candidate.screen),
      disabledReason: null,
    };
  }
  const { action } = candidate;
  return {
    kind: "action",
    action,
    label,
    description: text.description(action),
    binding: keymap[action] ?? null,
    disabledReason: disabledReason(action, state, text),
  };
}

/** The rows for this query, best first. An action's id and a screen's id are searched as well as
 *  the name, so typing the name the config uses (`files-find`) finds it too; only the name is
 *  highlighted. */
export function paletteRows(query: string, keymap: Keymap, state: PaletteState, text: PaletteText, sources: PaletteSources): PaletteRow[] {
  const scope = scopeOf(query);
  if (scope.help) return prefixRows(text);
  if (scope.only === "file" || scope.only === "content") return [handoffRow(HANDOFF_ACTIONS[scope.only], scope.rest, state, text)];
  const all = withAliases(candidatesFor(sources, state, text), aliasesByKey(sources.aliases), (candidate) => rowKey(rowOf(candidate, [], keymap, state, text)));
  const byCandidate = scope.only === null ? all : new Map([...all].filter(([, candidate]) => inScope(candidate.kind, scope.only)));
  const ranked = rankPaths([...byCandidate.keys()], scope.rest, byCandidate.size).flatMap((match, order) => {
    const candidate = byCandidate.get(match.path);
    if (candidate === undefined) return [];
    const row = rowOf(candidate, match.indexes, keymap, state, text);
    // Gated here as well as on the write: a stored key for a kind no longer remembered must not rank.
    return [{ row, score: match.score, used: isRemembered(row) ? sources.frecency(rowKey(row)) : 0, order }];
  });
  // Use only breaks a tie (#2533): a row that matches worse is never lifted over a better one.
  ranked.sort((a, b) => b.score - a.score || b.used - a.used || a.order - b.order);
  // The config file's word beats both (#2540): favorites with nothing typed, an exact alias always.
  const pins = { favorites: sources.favorites, nothingTyped: scope.rest.trim() === "", aliased: aliasTarget(sources.aliases, scope.rest) };
  return pinRows(
    ranked.map((entry) => entry.row),
    rowKey,
    pins,
  );
}

/** Each candidate's search text with the aliases written for its row, so an alias finds it. */
function withAliases(all: Map<string, Candidate>, byKey: Map<string, string[]>, keyOf: (candidate: Candidate) => string): Map<string, Candidate> {
  if (byKey.size === 0) return all;
  return new Map([...all].map(([search, candidate]): [string, Candidate] => [[search, ...(byKey.get(keyOf(candidate)) ?? [])].join(" "), candidate]));
}

const PREFIX_ICON = "filter_alt";

// `/` and `#` hand the text to the panel that already searches files, so they list nothing else.
const HANDOFF_ACTIONS: Record<"file" | "content", SeededFilesPanel> = { file: "files-find", content: "files-search" };

function handoffRow(action: SeededFilesPanel, query: string, state: PaletteState, text: PaletteText): HandoffRow {
  const label = [{ text: text.handoff(action, query), hit: false }];
  return {
    kind: "handoff",
    action,
    query,
    icon: HANDOFF_ICONS[action],
    label,
    description: text.description(action),
    disabledReason: disabledReason(action, state, text),
  };
}

const HANDOFF_ICONS: Record<SeededFilesPanel, string> = { "files-find": "search", "files-search": "manage_search" };

// `>` means "run something": the grid's actions and the terminal's commands alike (#2465), and the
// Run and Skill menus' entries (#2697).
const RUN_KINDS: ReadonlySet<Candidate["kind"]> = new Set(["action", "command", "collection", "launch", "start", "resume", "reopen", "script", "skill"]);
function inScope(kind: Candidate["kind"], only: ScopedKind | null): boolean {
  if (only === "action") return RUN_KINDS.has(kind);
  return kind === only;
}

/** What `?` lists: each symbol, and what it narrows the search to. */
function prefixRows(text: PaletteText): PaletteRow[] {
  return PALETTE_SCOPES.map(({ symbol, kind }) => ({
    kind: "prefix",
    symbol,
    icon: PREFIX_ICON,
    label: [{ text: text.scopeLabel(kind), hit: false }],
    description: symbol,
    disabledReason: null,
  }));
}
