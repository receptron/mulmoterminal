// The toolbar's operations as named actions: a `keymap` binding and a `run: "action"` header button
// reach them under these names. They act on the APP, not on a terminal, so they work on every
// screen.
import type { KeymapAction } from "./keymap.js";

export const SCREEN_ACTIONS = [
  "screen-terminals",
  "screen-collections",
  "screen-feeds",
  "screen-accounting",
  "screen-files",
  "screen-wiki",
  "screen-prs",
  "screen-rooms",
  "screen-blueprints",
  "screen-worklog",
  "screen-skills",
  "screen-library",
  "screen-processes",
  "screen-usage",
] as const satisfies readonly KeymapAction[];

export const ORDER_ACTIONS = ["order-auto", "order-manual", "order-priority"] as const satisfies readonly KeymapAction[];

export const APP_ACTIONS = [
  ...SCREEN_ACTIONS,
  "screen-toggle",
  "settings-open",
  "sound-toggle",
  "confetti",
  "view-toggle",
  ...ORDER_ACTIONS,
  "page-next",
  "page-prev",
  "terminal-reopen",
] as const satisfies readonly KeymapAction[];

// The ones the command palette already has a row for — a screen, a Settings section, the sound /
// view / order choices — so it does not list them a second time. Paging has no other row.
export const LISTED_ELSEWHERE_IN_PALETTE: readonly KeymapAction[] = [...SCREEN_ACTIONS, "settings-open", "sound-toggle", "view-toggle", ...ORDER_ACTIONS];

export type ScreenAction = (typeof SCREEN_ACTIONS)[number];
export type OrderAction = (typeof ORDER_ACTIONS)[number];
export type AppAction = (typeof APP_ACTIONS)[number];

export const isAppAction = (value: unknown): value is AppAction => APP_ACTIONS.some((action) => action === value);
export const isScreenAction = (value: AppAction): value is ScreenAction => SCREEN_ACTIONS.some((action) => action === value);
export const isOrderAction = (value: AppAction): value is OrderAction => ORDER_ACTIONS.some((action) => action === value);

const SCREEN_OF = {
  "screen-terminals": "terminals",
  "screen-collections": "collections",
  "screen-feeds": "feeds",
  "screen-accounting": "accounting",
  "screen-files": "files",
  "screen-wiki": "wiki",
  "screen-prs": "prs",
  "screen-rooms": "rooms",
  "screen-blueprints": "blueprints",
  "screen-worklog": "worklog",
  "screen-skills": "skills",
  "screen-library": "library",
  "screen-processes": "processes",
  "screen-usage": "usage",
} as const satisfies Record<ScreenAction, string>;

/** The screen a screen action goes to. */
export const screenOfAction = (action: ScreenAction): (typeof SCREEN_OF)[ScreenAction] => SCREEN_OF[action];

const ORDER_OF = { "order-auto": "auto", "order-manual": "manual", "order-priority": "priority" } as const satisfies Record<OrderAction, string>;

/** The cell order an order action chooses. */
export const orderOfAction = (action: OrderAction): (typeof ORDER_OF)[OrderAction] => ORDER_OF[action];
