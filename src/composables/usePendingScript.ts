import { ref } from "vue";
import type { RunCommand } from "../components/runCommand";

export type PendingCommand = RunCommand;

// Hands a script picked from the single view's terminal header over to the grid
// view: command cells live only in the grid, so the single view stashes the pick
// here, switches to the grid, and the grid runs it in a spare cell on mount.
const pending = ref<PendingCommand | null>(null);

export function usePendingScript() {
  const requestRun = (command: PendingCommand) => (pending.value = command);
  const takePending = (): PendingCommand | null => {
    const command = pending.value;
    pending.value = null;
    return command;
  };
  return { requestRun, takePending };
}
