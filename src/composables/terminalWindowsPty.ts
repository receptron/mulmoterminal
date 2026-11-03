import { ref } from "vue";
import { isTerminalWindowsPty, type TerminalWindowsPty } from "../../common/terminalWindowsPty";

// How the server's pty behaves, hydrated from /api/config: set only when it is a Windows ConPTY. A ref
// so the terminal manager can carry a config that lands after the first terminals were built.
const windowsPty = ref<TerminalWindowsPty | null>(null);

export const getTerminalWindowsPty = (): TerminalWindowsPty | null => windowsPty.value;

export const setTerminalWindowsPty = (value: unknown): void => {
  windowsPty.value = isTerminalWindowsPty(value) ? value : null;
};
