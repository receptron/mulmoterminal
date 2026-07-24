import { DEFAULT_TERMINAL_SUBMIT_MODE, type TerminalSubmitMode } from "../../common/terminalSubmit";

// The active submit/newline byte mapping, hydrated once from /api/config and read by
// every terminal's key handler at keydown time. A plain module value, not a ref: the
// handler reads it imperatively, one global mapping applies to all open terminals at
// once, and keeping it here (free of xterm imports) lets useAppConfig set it without
// pulling the terminal manager into the config layer.
let currentMode: TerminalSubmitMode = DEFAULT_TERMINAL_SUBMIT_MODE;

export const getTerminalSubmitMode = (): TerminalSubmitMode => currentMode;
export const setTerminalSubmitMode = (mode: TerminalSubmitMode): void => {
  currentMode = mode;
};
