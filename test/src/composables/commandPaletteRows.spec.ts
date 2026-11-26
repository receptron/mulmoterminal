import { describe, it, expect } from "vitest";
import { LISTED_ELSEWHERE_IN_PALETTE } from "../../../common/appActions";
import {
  PALETTE_ACTIONS,
  paletteRows,
  rowKey,
  type ActionRow,
  type PaletteRow,
  type PaletteState,
  type PaletteText,
} from "../../../src/composables/commandPaletteRows";
import type { Keymap } from "../../../common/keymap";
import { visibleScreens } from "../../../src/composables/paletteScreens";
import type { PaletteStart } from "../../../src/composables/paletteStarts";

// #2266. What the palette lists, how it ranks, and what it says about each row.
const TEXT: PaletteText = {
  label: (action) => `Label of ${action}`,
  description: (action) => `About ${action}`,
  needsEnlarged: "needs enlarged",
  needsNothingEnlarged: "not while enlarged",
  needsManualOrder: "manual order only",
  needsFilesPane: "files pane only",
  gridHidden: "grid hidden",
  screenLabel: (screen) => `Screen ${screen}`,
  screenDescription: (screen) => `Open ${screen}`,
  settingsLabel: (tab) => `Section ${tab}`,
  openInSettings: "in settings",
  currentChoice: "current",
  switchChoice: "switch",
  scopeLabel: (kind) => `Only ${kind}`,
  fromCollection: "collection",
  newTerminalIn: (dir) => `New in ${dir}`,
  launchDetail: "launch",
  gridFull: "full",
  startAgent: (agent) => `Start ${agent}`,
  runLauncher: (label) => `Launch ${label}`,
  startDetail: (dir) => `in ${dir}`,
  resumeLabel: (title) => `Resume ${title}`,
  wikiPage: (title) => `Wiki ${title}`,
  wikiDetail: "wiki page",
  promptLabel: (firstLine) => `Prompt ${firstLine}`,
  promptDetail: "put back",
  githubItem: (kind, number, title) => `${kind} #${number}: ${title}`,
  handoff: (action, query) => `${action} ${query}`,
  resumeDetail: (resume) => `at ${resume.mtime}`,
  reopenLabel: (title) => `Reopen ${title}`,
  reopenDetail: (closed) => `closed at ${closed.closedAt}`,
  runScript: (label) => `Run ${label}`,
  runSkill: (slug) => `Skill /${slug}`,
};
const NONE = {
  screens: [],
  terminals: [],
  settings: [],
  choices: [],
  commands: [],
  collectionActions: [],
  launchDirs: [],
  starts: [],
  startDir: null,
  resumes: [],
  closedCells: [],
  wikiPages: [],
  githubItems: [],
  prompts: [],
  scripts: [],
  skills: [],
  frecency: () => 0,
  aliases: {},
  favorites: [],
  gridFull: false,
};
const ZOOMED = { zoomed: true, available: true, manualOrder: true, filesOpen: false };
const UNZOOMED = { zoomed: false, available: true, manualOrder: true, filesOpen: false };
const labelText = (row: { label: { text: string }[] }) => row.label.map((part) => part.text).join("");

// The grid actions alone, as every test below written before screens were rows reads them.
const isAction = (row: PaletteRow): row is ActionRow => row.kind === "action";
const actionRowsOf = (query: string, keymap: Keymap, state: PaletteState, text: PaletteText): ActionRow[] =>
  paletteRows(query, keymap, state, text, NONE).filter(isAction);

describe("PALETTE_ACTIONS", () => {
  it("leaves out copy, paste and the palette itself", () => {
    expect(PALETTE_ACTIONS).not.toContain("copy");
    expect(PALETTE_ACTIONS).not.toContain("paste");
    expect(PALETTE_ACTIONS).not.toContain("command-palette");
    expect(PALETTE_ACTIONS).toContain("files-find");
  });

  // #2639: the palette already has a screen / Settings / choice row for each toolbar operation.
  it("leaves out the toolbar's operations it lists as screens, Settings sections and choices", () => {
    LISTED_ELSEWHERE_IN_PALETTE.forEach((action) => expect(PALETTE_ACTIONS).not.toContain(action));
    // Paging has no other row, so it is listed as an action (#2654).
    expect(PALETTE_ACTIONS).toContain("page-next");
    expect(PALETTE_ACTIONS).toContain("page-prev");
  });
});

describe("paletteRows", () => {
  it("lists every action in order when nothing is typed", () => {
    expect(actionRowsOf("", {}, ZOOMED, TEXT).map((row) => row.action)).toEqual([...PALETTE_ACTIONS]);
  });

  it("finds an action by its id, and puts the closest first", () => {
    const [first] = actionRowsOf("find", {}, ZOOMED, TEXT);
    expect(first?.action).toBe("files-find");
  });

  it("finds an action by its name", () => {
    const rows = actionRowsOf("restart", {}, ZOOMED, { ...TEXT, label: (action) => (action === "terminal-restart" ? "Restart the agent" : "Other") });
    expect(rows[0]?.action).toBe("terminal-restart");
  });

  it("highlights only within the name, never in the id searched beside it", () => {
    const [row] = actionRowsOf("files-find", {}, ZOOMED, { ...TEXT, label: () => "Open" });
    expect(row && labelText(row)).toBe("Open");
  });

  it("lists nothing for a query no action matches", () => {
    expect(actionRowsOf("zzzzqqq", {}, ZOOMED, TEXT)).toEqual([]);
  });

  it("shows the binding as the user wrote it, and null when there is none", () => {
    const rows = actionRowsOf("", { "files-find": "Cmd+k p" }, ZOOMED, TEXT);
    expect(rows.find((row) => row.action === "files-find")?.binding).toBe("Cmd+k p");
    expect(rows.find((row) => row.action === "zoom-toggle")?.binding).toBeNull();
  });

  it("says why an action cannot run in the current view", () => {
    const unzoomed = actionRowsOf("", {}, UNZOOMED, TEXT);
    expect(unzoomed.find((row) => row.action === "files-find")?.disabledReason).toBe("needs enlarged");
    expect(unzoomed.find((row) => row.action === "focus-next")?.disabledReason).toBeNull();
    const zoomed = actionRowsOf("", {}, ZOOMED, TEXT);
    expect(zoomed.find((row) => row.action === "focus-next")?.disabledReason).toBe("not while enlarged");
    expect(zoomed.find((row) => row.action === "zoom-toggle")?.disabledReason).toBeNull();
  });

  // #2655: on the full-screen Files view the grid is not in front, but that view takes the Files
  // actions itself — except inserting a selection, which needs a terminal beside it.
  it("enables the Files actions while the full-screen Files view is up", () => {
    const filesScreen = { ...UNZOOMED, available: false, filesScreen: true };
    const rows = actionRowsOf("", {}, filesScreen, TEXT);
    expect(rows.find((row) => row.action === "files-find")?.disabledReason).toBeNull();
    expect(rows.find((row) => row.action === "files-tab-next")?.disabledReason).toBeNull();
    expect(rows.find((row) => row.action === "files-insert-selection")?.disabledReason).not.toBeNull();
    expect(rows.find((row) => row.action === "zoom-toggle")?.disabledReason).not.toBeNull();
  });

  it("carries each action's description", () => {
    expect(actionRowsOf("", {}, ZOOMED, TEXT)[0]?.description).toBe(`About ${PALETTE_ACTIONS[0]}`);
  });

  // Over another view or the launch panel the grid takes no keys, and a pick would act on a grid
  // nobody is looking at (codex on #2286).
  it("disables every row while the grid is not in front", () => {
    const rows = actionRowsOf("", {}, { zoomed: true, available: false, manualOrder: true, filesOpen: false }, TEXT);
    expect(rows.every((row) => row.disabledReason === "grid hidden")).toBe(true);
  });
});

// Moving a terminal only means something in manual order; in auto and priority order the grid
// decides the position, so the row says why instead of running a move the next sort would undo.
describe("the move actions", () => {
  it("are listed, and runnable in manual order in either view", () => {
    for (const state of [ZOOMED, UNZOOMED]) {
      const rows = actionRowsOf("", {}, state, TEXT).filter((row) => row.action.startsWith("terminal-move-"));
      expect(rows.map((row) => [row.action, row.disabledReason])).toEqual([
        ["terminal-move-prev", null],
        ["terminal-move-next", null],
      ]);
    }
  });

  it("say they need manual order otherwise", () => {
    const rows = actionRowsOf("", {}, { ...UNZOOMED, manualOrder: false }, TEXT);
    expect(rows.find((row) => row.action === "terminal-move-next")?.disabledReason).toBe("manual order only");
    // Nothing else depends on the order.
    expect(rows.find((row) => row.action === "zoom-toggle")?.disabledReason).toBeNull();
  });
});

// The Files pane's tab actions (#2267) act on a pane that is up, and do not open one — and so does
// the selection insert (#2575): there is no selection in a pane that was not there.
describe("the Files tab actions", () => {
  const TAB_ACTIONS = ["files-tab-close", "files-tab-next", "files-tab-prev", "files-insert-selection"];
  const reasons = (state: typeof ZOOMED) =>
    actionRowsOf("", {}, state, TEXT)
      .filter((row) => TAB_ACTIONS.includes(row.action))
      .map((row) => [row.action, row.disabledReason]);

  it("are listed, and runnable with the pane up beside an enlarged terminal", () => {
    expect(reasons({ ...ZOOMED, filesOpen: true })).toEqual(TAB_ACTIONS.map((action) => [action, null]));
  });

  it("say they need the pane when it is closed", () => {
    expect(reasons(ZOOMED)).toEqual(TAB_ACTIONS.map((action) => [action, "files pane only"]));
  });

  it("say they need an enlarged terminal first, since the key names no tile to act on", () => {
    expect(reasons({ ...UNZOOMED, filesOpen: true })).toEqual(TAB_ACTIONS.map((action) => [action, "needs enlarged"]));
  });

  it("leave the finder and the search alone, which open the pane themselves", () => {
    const rows = actionRowsOf("", {}, ZOOMED, TEXT);
    expect(rows.find((row) => row.action === "files-find")?.disabledReason).toBeNull();
    expect(rows.find((row) => row.action === "files-search")?.disabledReason).toBeNull();
  });
});

// #2441. Screens are rows too: they need no grid, so they are never disabled, and they lead the
// list wherever the grid is not in front.
describe("screen rows", () => {
  const ALL_SET_UP = { prs: true, rooms: true, worklog: true, usage: false };
  const HIDDEN = { zoomed: false, available: false, manualOrder: true, filesOpen: false };

  it("lists every screen after the actions while the grid is in front", () => {
    const rows = paletteRows("", {}, UNZOOMED, TEXT, { ...NONE, screens: visibleScreens(ALL_SET_UP) });
    expect(rows.slice(0, PALETTE_ACTIONS.length).every(isAction)).toBe(true);
    expect(rows.slice(PALETTE_ACTIONS.length).map(rowKey)).toEqual([
      "screen:terminals",
      "screen:collections",
      "screen:feeds",
      "screen:accounting",
      "screen:files",
      "screen:wiki",
      "screen:prs",
      "screen:rooms",
      "screen:blueprints",
      "screen:worklog",
      "screen:skills",
      "screen:processes",
      "screen:usage",
    ]);
  });

  it("puts the screens first, and runnable, anywhere else", () => {
    const rows = paletteRows("", {}, HIDDEN, TEXT, { ...NONE, screens: visibleScreens(ALL_SET_UP) });
    expect(rows[0]?.kind).toBe("screen");
    expect(rows.filter((row) => row.kind === "screen").every((row) => row.disabledReason === null)).toBe(true);
    expect(rows.filter(isAction).every((row) => row.disabledReason === "grid hidden")).toBe(true);
  });

  it("finds a screen by name, with its icon and line", () => {
    const [first] = paletteRows("Screen wiki", {}, HIDDEN, TEXT, { ...NONE, screens: visibleScreens(ALL_SET_UP) });
    expect(first).toMatchObject({ kind: "screen", screen: "wiki", icon: "menu_book", description: "Open wiki" });
  });

  it("offers no screen for a feature that is not set up", () => {
    const keys = paletteRows("", {}, UNZOOMED, TEXT, { ...NONE, screens: visibleScreens({ prs: false, rooms: false, worklog: false }) }).map(rowKey);
    expect(keys).not.toContain("screen:prs");
    expect(keys).not.toContain("screen:rooms");
    expect(keys).not.toContain("screen:worklog");
    expect(keys).toContain("screen:blueprints");
  });
});

// #2446. The grid's terminals are rows too, found by part of their path.
describe("terminal rows", () => {
  const terminal = (uid: number, path: string, keywords = "") => ({ uid, path, detail: `detail ${uid}`, keywords });
  const TERMINALS = [terminal(1, "~/ss/llm/mulmoclaude"), terminal(2, "~/ss/llm/mulmoterminal4", "release"), terminal(3, "~/ss/llm/mulmoterminal4")];
  const HIDDEN = { zoomed: false, available: false, manualOrder: true, filesOpen: false };

  it("finds a terminal by part of its path, and keeps two in one directory apart", () => {
    const rows = paletteRows("term4", {}, UNZOOMED, TEXT, { ...NONE, screens: [], terminals: TERMINALS }).filter((row) => row.kind === "terminal");
    expect(rows.map(rowKey).sort()).toEqual(["terminal:2", "terminal:3"]);
    expect(rows.find((row) => rowKey(row) === "terminal:2")).toMatchObject({ icon: "terminal", description: "detail 2", disabledReason: null });
  });

  it("finds one by its memo", () => {
    const [first] = paletteRows("release", {}, UNZOOMED, TEXT, { ...NONE, screens: [], terminals: TERMINALS });
    expect(first && rowKey(first)).toBe("terminal:2");
  });

  it("lists them after the actions on the grid, and after the screens elsewhere", () => {
    const onGrid = paletteRows("", {}, UNZOOMED, TEXT, {
      ...NONE,
      screens: visibleScreens({ prs: false, rooms: false, worklog: false }),
      terminals: TERMINALS,
    }).map((row) => row.kind);
    expect(onGrid.indexOf("terminal")).toBe(PALETTE_ACTIONS.length);
    const elsewhere = paletteRows("", {}, HIDDEN, TEXT, { ...NONE, screens: ["wiki"], terminals: TERMINALS }).map((row) => row.kind);
    expect(elsewhere.slice(0, 4)).toEqual(["screen", "terminal", "terminal", "terminal"]);
  });
});

// #2450. Settings sections are rows too, opened in Settings.
describe("settings rows", () => {
  const HIDDEN = { zoomed: false, available: false, manualOrder: true, filesOpen: false };

  it("lists each section with its name and the Settings line, last on the grid", () => {
    const rows = paletteRows("", {}, UNZOOMED, TEXT, { ...NONE, screens: ["wiki"], settings: ["theme", "shortcuts"] });
    expect(rows.slice(-2).map(rowKey)).toEqual(["settings:theme", "settings:shortcuts"]);
    expect(rows.at(-1)).toMatchObject({ kind: "settings", icon: "settings", description: "in settings", disabledReason: null });
  });

  it("lists them before the actions elsewhere, and finds one by name", () => {
    const kinds = paletteRows("", {}, HIDDEN, TEXT, { ...NONE, screens: ["wiki"], settings: ["theme"] }).map((row) => row.kind);
    expect(kinds.slice(0, 2)).toEqual(["screen", "settings"]);
    const [first] = paletteRows("Section shortcuts", {}, HIDDEN, TEXT, { ...NONE, settings: ["theme", "shortcuts"] });
    expect(first && rowKey(first)).toBe("settings:shortcuts");
  });
});

// #2455. Settings switched in place are rows too; the one in effect says so.
describe("choice rows", () => {
  const CHOICES = [
    { id: "theme:nord", icon: "palette", label: "Theme: Nord", current: true },
    { id: "theme:dracula", icon: "palette", label: "Theme: Dracula", current: false },
  ];

  it("lists each choice with its icon, and marks the current one", () => {
    const rows = paletteRows("Theme", {}, UNZOOMED, TEXT, { ...NONE, choices: CHOICES }).filter((row) => row.kind === "choice");
    expect(rows.map(rowKey).sort()).toEqual(["choice:theme:dracula", "choice:theme:nord"]);
    expect(rows.find((row) => rowKey(row) === "choice:theme:nord")).toMatchObject({ icon: "palette", description: "current", disabledReason: null });
    expect(rows.find((row) => rowKey(row) === "choice:theme:dracula")?.description).toBe("switch");
  });
});

// #2462. A leading symbol narrows the rows to one kind; `?` lists the symbols.
describe("a leading symbol", () => {
  const TERMINALS = [{ uid: 1, path: "~/work/app", detail: "claude", keywords: "" }];
  const SOURCES = { ...NONE, screens: ["files" as const], terminals: TERMINALS };

  it("keeps only actions after >, matched on what follows it", () => {
    const rows = paletteRows("> find", {}, UNZOOMED, TEXT, SOURCES);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.kind === "action")).toBe(true);
    expect(rows[0] && rowKey(rows[0])).toBe("files-find");
  });

  it("keeps only terminals after @", () => {
    expect(paletteRows("@", {}, UNZOOMED, TEXT, SOURCES).map(rowKey)).toEqual(["terminal:1"]);
    expect(paletteRows("@app", {}, UNZOOMED, TEXT, SOURCES).map(rowKey)).toEqual(["terminal:1"]);
  });

  it("lists the symbols after ?", () => {
    const rows = paletteRows("?", {}, UNZOOMED, TEXT, SOURCES);
    expect(rows.map(rowKey)).toEqual(["prefix:>", "prefix:@", "prefix:/", "prefix:#"]);
    expect(rows[1]).toMatchObject({ kind: "prefix", description: "@", disabledReason: null });
  });
});

// #2465. The acting terminal's buttons and commands are rows beside the grid's actions, and `>`
// finds them with the actions.
describe("command rows", () => {
  const COMMANDS = [{ id: "release", label: "Release", icon: "bolt", detail: "command" }];

  it("lists them right after the actions on the grid", () => {
    const rows = paletteRows("", {}, UNZOOMED, TEXT, { ...NONE, commands: COMMANDS });
    expect(rows[PALETTE_ACTIONS.length]).toMatchObject({ kind: "command", id: "release", icon: "bolt", description: "command", disabledReason: null });
  });

  it("is found by > together with the actions", () => {
    expect(paletteRows("> Release", {}, UNZOOMED, TEXT, { ...NONE, commands: COMMANDS }).map(rowKey)).toContain("command:release");
    expect(paletteRows("@ Release", {}, UNZOOMED, TEXT, { ...NONE, commands: COMMANDS }).map(rowKey)).not.toContain("command:release");
  });
});

// #2471. Collection actions are rows beside the terminal's commands, found by > too, and two
// collections with an action of the same name stay two rows.
describe("collection rows", () => {
  const ACTIONS = [
    { slug: "inv", id: "sum", label: "Invoices: Summarise", icon: "summarize" },
    { slug: "tasks", id: "sum", label: "Tasks: Summarise", icon: "task" },
    // Two collections with one title: only the slug tells their actions apart.
    { slug: "notes-a", id: "sum", label: "Notes: Summarise", icon: "note" },
    { slug: "notes-b", id: "sum", label: "Notes: Summarise", icon: "note" },
  ];

  it("lists each one, keyed by its collection", () => {
    const rows = paletteRows("Summarise", {}, UNZOOMED, TEXT, { ...NONE, collectionActions: ACTIONS }).filter((row) => row.kind === "collection");
    expect(rows.map(rowKey).sort()).toEqual(["collection:inv:sum", "collection:notes-a:sum", "collection:notes-b:sum", "collection:tasks:sum"]);
    expect(rows[0]).toMatchObject({ description: "collection", disabledReason: null });
  });

  it("is found by > with the actions, and not by @", () => {
    expect(paletteRows("> Invoices", {}, UNZOOMED, TEXT, { ...NONE, collectionActions: ACTIONS }).map(rowKey)).toContain("collection:inv:sum");
    expect(paletteRows("@ Invoices", {}, UNZOOMED, TEXT, { ...NONE, collectionActions: ACTIONS }).map(rowKey)).not.toContain("collection:inv:sum");
  });
});

// #2484. Opening a new terminal is a run too, so > finds it with the actions.
describe("launch rows", () => {
  const DIRS = [{ path: "/home/me/app", label: "~/app" }];

  it("lists each directory, and > finds it", () => {
    expect(paletteRows("", {}, UNZOOMED, TEXT, { ...NONE, launchDirs: DIRS }).map(rowKey)).toContain("launch:/home/me/app");
    expect(paletteRows("> New in ~/app", {}, UNZOOMED, TEXT, { ...NONE, launchDirs: DIRS }).map(rowKey)).toContain("launch:/home/me/app");
    expect(paletteRows("@ New in ~/app", {}, UNZOOMED, TEXT, { ...NONE, launchDirs: DIRS }).map(rowKey)).not.toContain("launch:/home/me/app");
  });

  it("is refused, with the reason on it, while the grid is full", () => {
    const [row] = paletteRows("New in ~/app", {}, UNZOOMED, TEXT, { ...NONE, launchDirs: DIRS, gridFull: true });
    expect(row?.disabledReason).toBe("full");
    const [open] = paletteRows("New in ~/app", {}, UNZOOMED, TEXT, { ...NONE, launchDirs: DIRS });
    expect(open?.disabledReason).toBeNull();
  });
});

// #2487. An agent or a launcher starts in the acting terminal's directory, which the row names.
describe("start rows", () => {
  const STARTS: PaletteStart[] = [
    { kind: "agent", pick: "codex", label: "Codex" },
    { kind: "launcher", index: 0, label: "htop" },
  ];
  const HERE = { ...NONE, starts: STARTS, startDir: "~/app" };

  it("lists each start with the directory it runs in", () => {
    const rows = paletteRows("", {}, UNZOOMED, TEXT, HERE);
    expect(rows.map(rowKey)).toEqual(expect.arrayContaining(["start:agent:codex", "start:launcher:0"]));
    expect(rows.find((row) => rowKey(row) === "start:agent:codex")?.description).toBe("in ~/app");
  });

  it("lists none with no directory to run in", () => {
    expect(
      paletteRows("", {}, UNZOOMED, TEXT, { ...HERE, startDir: null })
        .map(rowKey)
        .filter((key) => key.startsWith("start:")),
    ).toEqual([]);
  });

  it("is found by > with the actions, and not by @", () => {
    expect(paletteRows("> Start Codex", {}, UNZOOMED, TEXT, HERE).map(rowKey)).toContain("start:agent:codex");
    expect(paletteRows("@ Start Codex", {}, UNZOOMED, TEXT, HERE).map(rowKey)).not.toContain("start:agent:codex");
  });

  it("is refused, with the reason on it, while the grid is full", () => {
    const [row] = paletteRows("Launch htop", {}, UNZOOMED, TEXT, { ...HERE, gridFull: true });
    expect(row && rowKey(row)).toBe("start:launcher:0");
    expect(row?.disabledReason).toBe("full");
    const [open] = paletteRows("Launch htop", {}, UNZOOMED, TEXT, HERE);
    expect(open?.disabledReason).toBeNull();
  });
});

// #2498. A past conversation of the acting directory resumes beside it.
describe("resume rows", () => {
  const RESUMES = [{ id: "s1", title: "Fix login", mtime: 7, cwd: "/w/app", account: null }];
  const HERE = { ...NONE, resumes: RESUMES };

  it("lists each resumable conversation by its title, with when it was last used", () => {
    const row = paletteRows("", {}, UNZOOMED, TEXT, HERE).find((candidate) => rowKey(candidate) === "resume::s1");
    expect(row?.description).toBe("at 7");
  });

  it("is found by its title and by >, and not by @", () => {
    expect(paletteRows("login", {}, UNZOOMED, TEXT, HERE).map(rowKey)).toContain("resume::s1");
    expect(paletteRows("> Resume Fix", {}, UNZOOMED, TEXT, HERE).map(rowKey)).toContain("resume::s1");
    expect(paletteRows("@ Resume Fix", {}, UNZOOMED, TEXT, HERE).map(rowKey)).not.toContain("resume::s1");
  });

  // One conversation id can be listed under two logins (#2215): two rows, not one.
  it("keeps the same conversation under two logins apart", () => {
    const both = [...RESUMES, { id: "s1", title: "Fix login", mtime: 7, cwd: "/w/app", account: "work" }];
    const keys = paletteRows("Fix login", {}, UNZOOMED, TEXT, { ...NONE, resumes: both }).map(rowKey);
    expect(keys).toEqual(expect.arrayContaining(["resume::s1", "resume:work:s1"]));
  });

  it("is refused, with the reason on it, while the grid is full", () => {
    const [row] = paletteRows("Resume Fix login", {}, UNZOOMED, TEXT, { ...HERE, gridFull: true });
    expect(row && rowKey(row)).toBe("resume::s1");
    expect(row?.disabledReason).toBe("full");
    const [open] = paletteRows("Resume Fix login", {}, UNZOOMED, TEXT, HERE);
    expect(open?.disabledReason).toBeNull();
  });
});

// #2503. A Wiki page is found by its title, slug, description or tags, and opens that page.
describe("wiki rows", () => {
  const PAGES = [
    { slug: "deploy-notes", title: "Deploy notes", description: "How we ship", keywords: "deploy-notes How we ship #ops" },
    { slug: "untitled", title: "untitled", description: "", keywords: "untitled" },
  ];
  const WITH = { ...NONE, wikiPages: PAGES };

  it("lists each page, with its description or a plain one", () => {
    const rows = paletteRows("", {}, UNZOOMED, TEXT, WITH);
    expect(rows.find((row) => rowKey(row) === "wiki:deploy-notes")?.description).toBe("How we ship");
    expect(rows.find((row) => rowKey(row) === "wiki:untitled")?.description).toBe("wiki page");
  });

  it("is found by a tag or the description, not only the title", () => {
    expect(paletteRows("ops", {}, UNZOOMED, TEXT, WITH).map(rowKey)[0]).toBe("wiki:deploy-notes");
    expect(paletteRows("ship", {}, UNZOOMED, TEXT, WITH).map(rowKey)).toContain("wiki:deploy-notes");
  });

  it("is not an action or a terminal, so > and @ leave it out", () => {
    expect(paletteRows("> Deploy", {}, UNZOOMED, TEXT, WITH).map(rowKey)).not.toContain("wiki:deploy-notes");
    expect(paletteRows("@ Deploy", {}, UNZOOMED, TEXT, WITH).map(rowKey)).not.toContain("wiki:deploy-notes");
  });
});

// `/` and `#` hand what was typed to the Files pane's finder and search, and list nothing else.
describe("handoff rows", () => {
  const WITH = { ...NONE, screens: ["files" as const], wikiPages: [{ slug: "app", title: "app", description: "", keywords: "app" }] };

  it("offers the finder for / and the search for #, with the text after the symbol", () => {
    expect(paletteRows("/ app.ts", {}, ZOOMED, TEXT, WITH)).toEqual([expect.objectContaining({ kind: "handoff", action: "files-find", query: "app.ts" })]);
    expect(paletteRows("#TODO", {}, ZOOMED, TEXT, WITH)).toEqual([expect.objectContaining({ kind: "handoff", action: "files-search", query: "TODO" })]);
  });

  it("finds a terminal by an absolute path after @", () => {
    const terminals = [{ uid: 3, path: "/srv/app", detail: "", keywords: "" }];
    expect(paletteRows("@/srv/app", {}, ZOOMED, TEXT, { ...WITH, terminals }).map(rowKey)).toEqual(["terminal:3"]);
  });

  it("opens an empty finder for a bare symbol", () => {
    expect(paletteRows("/", {}, UNZOOMED, TEXT, WITH)).toEqual([expect.objectContaining({ action: "files-find", query: "" })]);
  });

  it("is refused where the finder cannot open, with the finder's own reason", () => {
    const [row] = paletteRows("/ app", {}, { ...ZOOMED, available: false }, TEXT, WITH);
    expect(row?.disabledReason).toBe(TEXT.gridHidden);
    const [unzoomed] = paletteRows("/ app", {}, UNZOOMED, TEXT, WITH);
    expect(unzoomed?.disabledReason).toBe(TEXT.needsEnlarged);
    const [ready] = paletteRows("/ app", {}, ZOOMED, TEXT, WITH);
    expect(ready?.disabledReason).toBeNull();
  });
});

// #2517. An open PR or Issue is found by its title, repo or number, and names its repo.
describe("github rows", () => {
  const ITEMS = [
    { kind: "pr" as const, repo: "acme/app", number: 12, title: "Fix login", url: "https://github.com/acme/app/pull/12" },
    { kind: "issue" as const, repo: "acme/api", number: 34, title: "Slow list", url: "https://github.com/acme/api/issues/34" },
  ];
  const WITH = { ...NONE, githubItems: ITEMS };

  it("lists each with its repo, and a PR and an Issue look different", () => {
    const rows = paletteRows("", {}, UNZOOMED, TEXT, WITH);
    const pr = rows.find((row) => rowKey(row) === "github:pr:acme/app#12");
    const issue = rows.find((row) => rowKey(row) === "github:issue:acme/api#34");
    expect(pr?.description).toBe("acme/app");
    expect(pr && "icon" in pr && pr.icon).toBe("github:git-pull-request");
    expect(issue && "icon" in issue && issue.icon).toBe("github:issue-opened");
  });

  // A leading `#` is file contents (#2512), so a number is typed bare or after the repo.
  it("is found by its number, its repo or its title", () => {
    expect(paletteRows("#34", {}, UNZOOMED, TEXT, WITH)[0]?.kind).toBe("handoff");
    expect(paletteRows("api#34", {}, UNZOOMED, TEXT, WITH).map(rowKey)[0]).toBe("github:issue:acme/api#34");
    expect(paletteRows("api 34", {}, UNZOOMED, TEXT, WITH).map(rowKey)[0]).toBe("github:issue:acme/api#34");
    expect(paletteRows("login", {}, UNZOOMED, TEXT, WITH).map(rowKey)[0]).toBe("github:pr:acme/app#12");
  });
});

// #2523. A past prompt is found by any of its text and named by its first line.
describe("prompt rows", () => {
  const PROMPTS = [
    { index: 0, text: "fix the login\nthen run the payment tests", uid: 1, slotKey: "cell-1" },
    { index: 1, text: "fix the login", uid: 1, slotKey: "cell-1" },
  ];
  const WITH = { ...NONE, prompts: PROMPTS };

  it("names each by its first line, and keeps two alike apart", () => {
    const rows = paletteRows("", {}, UNZOOMED, TEXT, WITH).filter((row) => row.kind === "prompt");
    expect(rows.map(rowKey)).toEqual(["prompt:0", "prompt:1"]);
    expect(rows[0]?.label.map((part) => part.text).join("")).toBe("Prompt fix the login");
    expect(rows[0]?.description).toBe("put back");
  });

  it("is found by a later line of the prompt", () => {
    expect(paletteRows("payment", {}, UNZOOMED, TEXT, WITH).map(rowKey)).toEqual(["prompt:0"]);
  });

  it("is not an action or a terminal, so > and @ leave it out", () => {
    expect(paletteRows("> login", {}, UNZOOMED, TEXT, WITH).map(rowKey)).not.toContain("prompt:1");
    expect(paletteRows("@ login", {}, UNZOOMED, TEXT, WITH).map(rowKey)).not.toContain("prompt:1");
  });
});

// #2533. What was picked before breaks ties, and only ties.
describe("frecency", () => {
  const item = (number: number, title: string) => ({
    kind: "issue" as const,
    repo: "acme/app",
    number,
    title,
    url: `https://github.com/acme/app/issues/${number}`,
  });
  const WITH = { ...NONE, githubItems: [item(1, "deploy"), item(2, "deploy"), item(3, "deployment notes"), item(4, "dry empty plot yard")] };
  const used = (key: string) => (candidate: string) => (candidate === key ? 5 : 0);
  const key = (number: number) => `github:issue:acme/app#${number}`;

  it("keeps the match order when nothing has been used", () => {
    const order = paletteRows("deploy", {}, UNZOOMED, TEXT, WITH).map(rowKey);
    expect(paletteRows("deploy", {}, UNZOOMED, TEXT, { ...WITH, frecency: () => 0 }).map(rowKey)).toEqual(order);
  });

  it("puts a used row first among rows that match as well", () => {
    const [first] = paletteRows("deploy", {}, UNZOOMED, TEXT, { ...WITH, frecency: used(key(2)) }).map(rowKey);
    expect(first).toBe(key(2));
  });

  it("puts used rows first when nothing is typed", () => {
    const [first] = paletteRows("", {}, UNZOOMED, TEXT, { ...WITH, frecency: used(key(3)) }).map(rowKey);
    expect(first).toBe(key(3));
  });

  // "dry empty plot yard" holds d-e-p-l-o-y only scattered, so it matches worse than the rest.
  it("never lifts a worse match over a better one", () => {
    const lifted = paletteRows("deploy", {}, UNZOOMED, TEXT, { ...WITH, frecency: used(key(4)) }).map(rowKey);
    expect(lifted.at(-1)).toBe(key(4));
  });

  // A key stored before a kind left the allowlist, or written by hand, must not rank that row.
  it("ignores a stored use of a row that is not remembered", () => {
    const pages = [
      { slug: "a", title: "notes", description: "", keywords: "a" },
      { slug: "b", title: "notes", description: "", keywords: "b" },
    ];
    const plain = paletteRows("notes", {}, UNZOOMED, TEXT, { ...NONE, wikiPages: pages }).map(rowKey);
    expect(plain.slice(0, 2)).toEqual(["wiki:a", "wiki:b"]); // the premise: a tie a stored use could break
    expect(paletteRows("notes", {}, UNZOOMED, TEXT, { ...NONE, wikiPages: pages, frecency: used("wiki:b") }).map(rowKey)).toEqual(plain);
  });
});

// #2540. The config file's aliases and favorites.
describe("aliases and favorites", () => {
  const PAGES = [
    { slug: "a", title: "Deploy notes", description: "", keywords: "a" },
    { slug: "b", title: "Release plan", description: "", keywords: "b" },
  ];
  const WITH = { ...NONE, wikiPages: PAGES };

  it("finds a row by an alias written for it, and puts it first when the alias is typed exactly", () => {
    const rows = paletteRows("rp", {}, UNZOOMED, TEXT, { ...WITH, aliases: { rp: "wiki:b" } }).map(rowKey);
    expect(rows[0]).toBe("wiki:b");
  });

  it("does not bring an aliased row outside the scope typed", () => {
    expect(paletteRows("@ rp", {}, UNZOOMED, TEXT, { ...WITH, aliases: { rp: "wiki:b" } }).map(rowKey)).not.toContain("wiki:b");
  });

  it("puts favorites first with nothing typed, and not once something is", () => {
    expect(
      paletteRows("", {}, UNZOOMED, TEXT, { ...WITH, favorites: ["wiki:b", "wiki:a"] })
        .map(rowKey)
        .slice(0, 2),
    ).toEqual(["wiki:b", "wiki:a"]);
    // "e" matches both pages; the one that ranks lower stays lower once something is typed.
    const typed = paletteRows("e", {}, UNZOOMED, TEXT, WITH).map(rowKey);
    const lower = typed.filter((key) => key.startsWith("wiki:")).at(-1) ?? "";
    expect(typed.indexOf(lower)).toBeGreaterThan(0);
    expect(paletteRows("e", {}, UNZOOMED, TEXT, { ...WITH, favorites: [lower] }).map(rowKey)).toEqual(typed);
  });
});

// #2800. A cell closed recently opens again beside the acting terminal.
describe("reopen rows", () => {
  const CLOSED = [
    { kind: "session" as const, session: "s1", cwd: "/w/app", agent: "claude" as const, account: null, title: "Fix login", closedAt: 5 },
    { kind: "shell" as const, cwd: "/w/tools", title: "tools", closedAt: 3 },
  ];
  const HERE = { ...NONE, closedCells: CLOSED };

  it("lists each closed cell by its title, with when it was closed", () => {
    const row = paletteRows("", {}, UNZOOMED, TEXT, HERE).find((candidate) => rowKey(candidate) === "reopen:session::s1");
    expect(row && labelText(row)).toBe("Reopen Fix login");
    expect(row?.description).toBe("closed at 5");
  });

  it("is found by its title, its directory and >, and not by @", () => {
    expect(paletteRows("login", {}, UNZOOMED, TEXT, HERE).map(rowKey)).toContain("reopen:session::s1");
    expect(paletteRows("w/tools", {}, UNZOOMED, TEXT, HERE).map(rowKey)).toContain("reopen:shell:/w/tools");
    expect(paletteRows("> Reopen Fix", {}, UNZOOMED, TEXT, HERE).map(rowKey)).toContain("reopen:session::s1");
    expect(paletteRows("@ Reopen Fix", {}, UNZOOMED, TEXT, HERE).map(rowKey)).not.toContain("reopen:session::s1");
  });

  // Two sessions in one directory with no title of their own both read as the directory name.
  it("keeps two closed cells with the same title and directory apart", () => {
    const twins = [CLOSED[0], { ...CLOSED[0], session: "s2" }];
    const keys = paletteRows("", {}, UNZOOMED, TEXT, { ...NONE, closedCells: twins }).map(rowKey);
    expect(keys).toEqual(expect.arrayContaining(["reopen:session::s1", "reopen:session::s2"]));
  });

  // #3506: a remote cell's row names its host, and is found by it.
  it("names the host of a cell closed on a remote one", () => {
    const remote = { ...CLOSED[1], remoteHost: "lx" };
    const row = paletteRows("tools (lx)", {}, UNZOOMED, TEXT, { ...NONE, closedCells: [remote] }).find((candidate) => candidate.kind === "reopen");
    expect(row && [rowKey(row), labelText(row)]).toEqual(["reopen:remote:lx:shell:/w/tools", "Reopen tools (lx)"]);
  });

  it("lists nothing when nothing was closed", () => {
    expect(paletteRows("", {}, UNZOOMED, TEXT, NONE).some((row) => row.kind === "reopen")).toBe(false);
  });

  it("is refused, with the reason on it, while the grid is full", () => {
    const [row] = paletteRows("Reopen Fix login", {}, UNZOOMED, TEXT, { ...HERE, gridFull: true });
    expect(row && rowKey(row)).toBe("reopen:session::s1");
    expect(row?.disabledReason).toBe("full");
    const [open] = paletteRows("Reopen Fix login", {}, UNZOOMED, TEXT, HERE);
    expect(open?.disabledReason).toBeNull();
  });
});
