// Startup check for the `keymap` block of config.json.
//
// Why this refuses to boot instead of quietly dropping the bad entry: a shortcut is
// invisible until you press the key. A typo'd binding that is silently ignored looks
// exactly like a shortcut that "just doesn't work", and the user has no way to tell the
// two apart — they'd go hunting in the app for a problem that is one character in a file.
// Failing loudly at startup, naming the line, is the kinder failure.
//
// An UNKNOWN ACTION only warns: that is what a config written for a newer MulmoTerminal
// looks like, and downgrading must not brick the app. So does a binding that parses but
// cannot match in the browser that will connect — the warning channel is for an entry that
// loads and then does nothing, which is the failure this file exists to make visible.
import { validateKeymap } from "../../common/keymap.js";
import { isRecord } from "../../common/isRecord.js";

export interface KeymapCheck {
  warnings: string[];
  errors: string[];
}

const describe = (binding: unknown): string =>
  typeof binding === "string" ? JSON.stringify(binding) : `${typeof binding} ${JSON.stringify(binding) ?? String(binding)}`;

// Pure: the raw parsed config object in, human-readable lines out. The caller decides
// what to print and whether to exit.
export function checkKeymap(rawConfig: unknown): KeymapCheck {
  const keymap = isRecord(rawConfig) ? rawConfig.keymap : undefined;
  const problems = validateKeymap(keymap);
  const line = (p: (typeof problems)[number]) => `  keymap.${p.action}: ${describe(p.binding)} — ${p.reason}`;
  return {
    warnings: problems.filter((p) => !p.fatal).map(line),
    errors: problems.filter((p) => p.fatal).map(line),
  };
}

export interface KeymapCheckIo {
  readConfig: () => unknown;
  warn: (message: string) => void;
  fail: (message: string) => never;
}

// Run the check against the config file. Injected I/O so the policy is testable without a
// real home directory or a real process exit.
export function enforceKeymap(file: string, io: KeymapCheckIo): void {
  const { warnings, errors } = checkKeymap(io.readConfig());
  if (warnings.length > 0) io.warn(`[config] ${file}: keymap entries that will not do what they say\n${warnings.join("\n")}`);
  if (errors.length > 0) {
    io.fail(
      `[config] ${file}: invalid keymap — refusing to start\n${errors.join("\n")}\n\nA binding looks like "PageDown" or "Shift+PageUp" (modifiers: Shift, Ctrl, Alt/Option, Cmd), or two keys separated by a space, "Cmd+K p".\nFix or remove the entry, then start again.`,
    );
  }
}
