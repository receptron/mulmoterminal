// The header buttons a remote cell offers (#3506). Pure.
//
// The remote resolves its own buttons, so what they run is the remote's: a shell button runs there
// (a command cell through the gateway), an input button types into its terminal, and an action is
// decided by cellActionAllowed. An `open` button acts on THIS machine — its files, its folders, a
// terminal here, a file picked here — with a path from the other machine, so only a web URL stays.
import { isHeaderFolder, type HeaderButton, type HeaderEntry } from "../composables/useHeaderButtons";

// A URL wins: runHeaderButton opens it and nothing else when one is set.
const runsOnRemote = (button: HeaderButton): boolean => button.run !== "open" || Boolean(button.open?.url);

/** The entries a remote cell shows; a folder left empty is dropped with its buttons. */
export function remoteHeaderEntries(entries: readonly HeaderEntry[]): HeaderEntry[] {
  return entries.flatMap((entry): HeaderEntry[] => {
    if (!isHeaderFolder(entry)) return runsOnRemote(entry) ? [entry] : [];
    const items = entry.items.filter(runsOnRemote);
    return items.length > 0 ? [{ ...entry, items }] : [];
  });
}
