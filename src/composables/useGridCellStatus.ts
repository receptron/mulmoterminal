// Every grid cell's attention status, for the "auto" order and the toolbar tally — including cells on
// pages that aren't mounted. useGridActivity tracks each local cell session's live attention state
// by id (OFF-PAGE, dev-terminal cells too, which the /api/sessions list drops and its limit would
// cap), useRemoteGridActivity does the same for remote cells by host and id (#3506), and `byUid`
// (reported up while a cell is mounted) is the fallback for cells with no session id (command cells)
// and a just-launched cell before its id arrives.
import { computed, type ComputedRef, type Ref } from "vue";
import { useGridActivity } from "./useGridActivity";
import { useRemoteGridActivity } from "./useRemoteGridActivity";
import { activityStatus, type AttentionStatus } from "../components/attentionStatus";
import { resolveCellStatus, type Cell } from "../components/gridTabs";
import { activityKeyOf, remoteCellSessions } from "../components/remoteCell";

export function useGridCellStatus(
  cells: Ref<readonly Cell[]>,
  localCells: Ref<readonly Cell[]>,
  byUid: Readonly<Record<number, AttentionStatus>>,
): ComputedRef<Record<number, AttentionStatus>> {
  const cellSessionIds = computed(() => localCells.value.map((c) => c.session).filter((s): s is string => !!s));
  const { activity: gridActivity } = useGridActivity(cellSessionIds);
  const { activity: remoteActivity } = useRemoteGridActivity(computed(() => remoteCellSessions(cells.value)));
  const sessionStatus = computed(() => {
    const m = new Map<string, AttentionStatus>();
    for (const [id, a] of gridActivity) m.set(id, activityStatus(a.working, a.waiting, a.event));
    for (const [key, a] of remoteActivity) m.set(key, activityStatus(a.working, a.waiting, a.event));
    return m;
  });
  return computed(() =>
    resolveCellStatus(
      cells.value.map((cell) => ({ uid: cell.uid, session: activityKeyOf(cell) })),
      sessionStatus.value,
      byUid,
    ),
  );
}
