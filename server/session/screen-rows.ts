// A captured screen, row by row, with each row's DIM run kept beside its plain text.
//
// Dim is the one attribute that has to survive capture. Claude Code offers a follow-up
// prompt as dim ghost text in its input box — accepted with Tab at the keyboard:
//
//   ESC[39m❯ ESC[2mmilestones に目標を書くESC[0m
//
// Stripped of colour that is indistinguishable from a line the user typed, and the two
// need opposite handling on the phone: the ghost text can be sent as it stands, while
// typed text is already in the box and sending it again would double it.

export interface ScreenRow {
  text: string;
  // The dim-attributed part of the row, "" when it has none.
  dim: string;
}

const ESC = "\u001b";
const BEL = "\u0007";

// tmux's `capture-pane -e` re-emits two kinds of escape, both verified against a live
// pane: SGR (the attributes) and OSC 8 hyperlinks. Neither belongs in the text. The
// trailing alternative catches any other two-byte escape rather than printing it:
//
//   ESC ] <text> (BEL | ESC \)  |  ESC [ <params> <letter>  |  ESC <byte>
//
// Composed from the control bytes rather than written as one literal: a regex literal
// carrying them is exactly what the control-character lint rules exist to stop.
const ESCAPE_SPLIT = new RegExp(`(${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)?|${ESC}\\[[\\d;:]*[a-zA-Z]|${ESC}[@-_])`, "u");
const SGR = new RegExp(`^${ESC}\\[([\\d;:]*)m$`, "u");

// Walk SGR parameters left to right. 38/48/58 introduce an extended colour whose own
// arguments must be skipped — otherwise the trailing 2 of "38;5;2" (green) reads as the
// dim attribute and swallows the rest of the line.
const dimAfter = (dim: boolean, params: readonly string[]): boolean => {
  const [code, ...rest] = params;
  if (code === undefined) return dim;
  if (code === "38" || code === "48" || code === "58") return dimAfter(dim, rest.slice(rest[0] === "5" ? 2 : 4));
  if (code === "2") return dimAfter(true, rest);
  if (code === "" || code === "0" || code === "22") return dimAfter(false, rest);
  return dimAfter(dim, rest);
};

const dimAfterEscape = (sequence: string, dim: boolean): boolean => {
  const sgr = SGR.exec(sequence);
  return sgr === null ? dim : dimAfter(dim, sgr[1].split(";"));
};

interface RowScan {
  text: string;
  dim: string;
  on: boolean;
}

// Splitting on a capturing escape pattern yields text and escapes alternately, so the
// odd positions are the sequences and the even ones the printable runs between them.
const foldPart = (scan: RowScan, part: string, index: number): RowScan => {
  if (index % 2 === 1) return { ...scan, on: dimAfterEscape(part, scan.on) };
  return { ...scan, text: scan.text + part, dim: scan.on ? scan.dim + part : scan.dim };
};

// `capture-pane` drops the blanks that pad a row WITHOUT `-e` and keeps them WITH it,
// so they are dropped here — the phone is shown the plain screen. Only the ASCII space
// is padding: Claude Code draws its empty input box as "❯" + U+00A0, which tmux keeps
// and a plain trimEnd would eat.
// Scanned rather than matched with " +$", which backtracks quadratically on a row that
// is mostly blanks — and a screen row is as wide as the terminal.
const withoutTrailingPad = (text: string): string => text.slice(0, text.split("").findLastIndex((char) => char !== " ") + 1);

const parseRow = (line: string): ScreenRow => {
  const { text, dim } = line.split(ESCAPE_SPLIT).reduce(foldPart, { text: "", dim: "", on: false });
  return { text: withoutTrailingPad(text), dim: withoutTrailingPad(dim) };
};

export const parseStyledRows = (styled: string): ScreenRow[] => styled.split("\n").map(parseRow);

export const rowsToScreen = (rows: readonly ScreenRow[]): string => rows.map((row) => row.text).join("\n");

// The caret an agent draws in front of its input box. Deliberately NOT the ASCII ">":
// agent output is full of quoted lines and diffs, and one of those rendered dim would
// read as a suggestion the user never saw.
const CARET = /^\s*[❯›]\s/u;

const afterCaret = (text: string): string | undefined => {
  const caret = CARET.exec(text);
  return caret === null ? undefined : text.slice(caret[0].length);
};

// The row that OFFERS a suggestion: everything past the caret is dim. Text the user
// typed is not dim, which is what keeps a real draft out of this.
const offersSuggestion = (row: ScreenRow): boolean => {
  const rest = afterCaret(row.text)?.trim();
  return rest !== undefined && rest !== "" && rest === row.dim.trim();
};

// A wrapped continuation of the row above: no caret of its own, all of it dim.
const continuesSuggestion = (row: ScreenRow): boolean => {
  const text = row.text.trim();
  return text !== "" && text === row.dim.trim() && !CARET.test(row.text);
};

const ASCII_TAIL = /[!-~]$/u;
const ASCII_HEAD = /^[!-~]/u;

// The box wraps the ghost text itself, so the break carries no character: an English
// line break ate the space between two words, a Japanese one had none to eat.
const joinWrapped = (head: string, tail: string): string => {
  if (ASCII_TAIL.test(head) && ASCII_HEAD.test(tail)) return `${head} ${tail}`;
  return `${head}${tail}`;
};

const wrappedRows = (rows: readonly ScreenRow[]): readonly ScreenRow[] => {
  const broken = rows.findIndex((row) => !continuesSuggestion(row));
  return broken === -1 ? rows : rows.slice(0, broken);
};

// The suggestion the screen is currently offering, or "" when it is offering none.
// Scans for the LAST caret row: scrollback can hold an old prompt above the live one.
export const suggestionFromRows = (rows: readonly ScreenRow[]): string => {
  const start = rows.findLastIndex(offersSuggestion);
  if (start === -1) return "";
  return [rows[start], ...wrappedRows(rows.slice(start + 1))].map((row) => row.dim.trim()).reduce(joinWrapped);
};
