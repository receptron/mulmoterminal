// The Library's keys (#3329): `/` to search, arrows to move, Enter for the one primary action. Esc
// is the overlay's own (useEscapeToClose). Pure: the caller says where the key landed.

export type LibraryKeyAction = "focus-search" | "up" | "down" | "primary";

export interface LibraryKeyEvent {
  key: string;
  /** Typed into the Library's own search field. */
  inSearch: boolean;
  /** Typed into any OTHER editable field — keys there are that field's. */
  inOtherField: boolean;
  /** Focus is on another control (a button in the conversation, a link): Enter and the arrows are
   *  its own. The list's rows are not "another control" — moving and resuming is what they are for. */
  onOtherControl: boolean;
  /** An input method is composing: Enter there commits the text, it is not a command. */
  composing: boolean;
  modified: boolean;
}

export function libraryKeyAction(event: LibraryKeyEvent): LibraryKeyAction | null {
  if (event.composing || event.modified || event.inOtherField) return null;
  if (event.key === "/" && !event.inSearch) return "focus-search";
  if (event.onOtherControl) return null;
  if (event.key === "ArrowUp") return "up";
  if (event.key === "ArrowDown") return "down";
  return event.key === "Enter" ? "primary" : null;
}

/** The next index from a row that has LEFT the list (an unpinned one, say), where it last stood at
 *  `gap`: down lands on the row that took its place, up on the one before it. */
export const movedFromGap = (gap: number, by: number, length: number): number => movedIndex(by > 0 ? gap - 1 : gap, by, length);

/** The next index after moving `by`, held inside the list rather than wrapping. */
export const movedIndex = (current: number, by: number, length: number): number => (length === 0 ? -1 : Math.min(Math.max(current + by, 0), length - 1));
