// The tmux prefix key of the dedicated mulmoterminal tmux server (#2981).
//
// tmux's default `C-b` is also "one character left" in every readline, in Claude Code's input and
// in the macOS text system, so with it armed the first Ctrl+B in a cell is swallowed as a prefix and
// the next key is read as a tmux command. Nothing in this app uses the prefix: sessions are driven
// from the server with tmux commands, and the wheel reaches scrollback through the root table.
export const TMUX_PREFIX_NONE = "none";
export const TMUX_PREFIX_DEFAULT = TMUX_PREFIX_NONE;

// Control + one key, spelled the way tmux spells it. Deliberately narrow: each of these is written
// into a tmux conf line unquoted, so a character with meaning there never gets through.
const TMUX_CONTROL_KEY = /^C-(?:[a-z]|Space|\]|_|\^|@)$/u;

export const TMUX_PREFIX_CHOICES: readonly string[] = [TMUX_PREFIX_NONE, "C-b", "C-]"];

// vue-i18n reads `]` as path syntax, so the labels cannot be keyed by the tmux spelling itself.
export const TMUX_PREFIX_LABEL_KEYS: Readonly<Record<string, string>> = { none: "none", "C-b": "ctrlB", "C-]": "ctrlBracket" };

export const isTmuxPrefix = (input: unknown): input is string => input === TMUX_PREFIX_NONE || (typeof input === "string" && TMUX_CONTROL_KEY.test(input));

export const sanitizeTmuxPrefix = (input: unknown): string => (isTmuxPrefix(input) ? input : TMUX_PREFIX_DEFAULT);

const TMUX_OWN_DEFAULT_PREFIX = "C-b";

// The commands that put a prefix in force. Idempotent, so the same lines serve the conf file of a
// fresh server and a server that is already running. `unbind-key C-b` matters for "none" and for any
// other key: tmux binds the default's `send-prefix` in the prefix table independently of the option.
export function tmuxPrefixCommands(prefix: string): string[] {
  if (prefix === TMUX_PREFIX_NONE) return ["set -g prefix None", `unbind-key ${TMUX_OWN_DEFAULT_PREFIX}`];
  if (prefix === TMUX_OWN_DEFAULT_PREFIX) return [`set -g prefix ${prefix}`, `bind-key ${prefix} send-prefix`];
  return [`set -g prefix ${prefix}`, `unbind-key ${TMUX_OWN_DEFAULT_PREFIX}`, `bind-key ${prefix} send-prefix`];
}

// `list-keys -T prefix` prints one `bind-key [-r] -T prefix <key> <command>` per binding. Every key in
// the prefix table that sends the prefix on, other than the one now in force, is left over from an
// earlier setting - possibly from an earlier PROCESS, which is why this reads the server's own table
// instead of remembering what was set last.
// Read as words, not a pattern: flags such as `-r` may precede `-T prefix`.
const sendPrefixKeyOf = (line: string): string | undefined => {
  const words = line.trim().split(/\s+/u);
  const tableAt = words.indexOf("-T");
  const isPrefixTable = words[0] === "bind-key" && tableAt > 0 && words[tableAt + 1] === "prefix";
  const sendsPrefix = words.length === tableAt + 4 && words[tableAt + 3] === "send-prefix";
  return isPrefixTable && sendsPrefix ? words[tableAt + 2] : undefined;
};

export function staleSendPrefixKeys(listKeysOutput: string, prefix: string): string[] {
  return listKeysOutput
    .split("\n")
    .map(sendPrefixKeyOf)
    .filter((key): key is string => key !== undefined && key !== prefix);
}
