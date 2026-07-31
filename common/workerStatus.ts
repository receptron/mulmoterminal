// What a session row says about a BACKGROUND WORKER, as it travels from the server to the UI.
//
// Both sides decide from these two fields and they decide different things, so this is the shared
// CORE rather than either side's whole row:
//   - the server fills them per row from the persisted marks (session-reads.ts), and
//   - the launcher's resume list renders them as the `background` / `● failed` labels
//     (CellLaunchForm.vue), which is the only place a worker can be found once the single view
//     is gone.
// Each side keeps its own extras (title, mtime, working/waiting/event) next to its import.
//
// Shared rather than spelled twice because they are a WIRE shape: the server writes them, the
// browser reads them, and two copies of that is the drift `common/` exists to prevent. The two
// sides are deliberately not identical, though — see WorkerStatus vs PartialWorkerStatus below,
// and the spec that pins the asymmetry.
export interface WorkerStatus {
  /** Spawned as a hidden background worker (spawnBackgroundChat hidden:true, a scheduled
   *  refresh). It is still listed, but never bold and never unread — a helper finishing should
   *  not pull the user's attention. */
  hidden: boolean;
  /** That worker ended without ever completing a turn. The counterpart to `hidden`: a worker is
   *  quiet by design, so this is the one outcome the quiet is wrong for, and it rides on the row
   *  so a picker can say WHICH worker failed rather than making the user open each one. */
  failed: boolean;
}

/**
 * The same two fields as the CLIENT may receive them.
 *
 * Optional on purpose, and the asymmetry is load-bearing rather than laziness: the server always
 * fills both, but a browser also parses rows from an OLDER server (a page left open across an
 * upgrade, the phone's cached list), where neither field exists. Declaring them required there
 * would make the type lie about what can arrive, and the labels are absence-tolerant anyway —
 * "no badge" is exactly right for a row that never said.
 */
export type PartialWorkerStatus = Partial<WorkerStatus>;
