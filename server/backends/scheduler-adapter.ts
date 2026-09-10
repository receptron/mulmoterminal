// System-task scheduling with persistence + startup catch-up — the half of the scheduler that
// survives the server being off. Thin host binding over `@mulmoclaude/core/scheduler`, the same
// shape as MulmoClaude's `server/events/scheduler-adapter.ts`: the engine (state file, missed-
// window plan, execution log) is the shared package; this file injects THIS host's workspace
// root, atomic writer and logger.
//
// Without it, a task fires only if the process happens to be alive during the one tick minute
// its UTC window lands on, and a missed window is skipped forever with nothing recorded (#1581).
import { configureScheduler, initScheduler, type ITaskManager, type SchedulerLogger, type SystemTaskDef } from "@mulmoclaude/core/scheduler";
import { writeFileAtomic } from "../files/atomic-write.js";
import { seedSchedulerState } from "./scheduler-state-seed.js";

/** Point the package at this host. Sets module state and touches no disk, so it is safe to call
 *  on every boot — including one with no tasks at all, where the read-only routes still have to
 *  answer and a user task still has to be able to record its run. */
export function configureSchedulerAdapter(stateRoot: string, log: SchedulerLogger): void {
  configureScheduler({
    // `workspaceRoot` names the root state.json + logs hang off, and nothing else in the
    // package — so handing it the host state root is what keeps them out of a launch
    // directory that happens to be someone's project (host-state-root.ts).
    workspaceRoot: stateRoot,
    // The `uniqueTmp` option is what this writer already does unconditionally.
    writeFileAtomic: (filePath: string, content: string) => writeFileAtomic(filePath, content),
    log,
  });
}

/** Seed first-run state, run the catch-up plan, and register the system tasks for ongoing ticks.
 *  Requires `configureSchedulerAdapter` first.
 *
 *  Awaiting this delays nothing but the system tasks: `initScheduler` runs the catch-up plan
 *  inline and a caught-up feed refresh can take a while, so callers keep it off the boot path. */
export async function startSystemTaskScheduler(deps: {
  taskManager: ITaskManager;
  /** Must be the SAME root `configureSchedulerAdapter` got: the seed writes state.json
   *  directly, so a different root here seeds a file the adapter never reads. */
  stateRoot: string;
  tasks: SystemTaskDef[];
  log: SchedulerLogger;
}): Promise<void> {
  const seeded = await seedSchedulerState(deps.stateRoot, deps.tasks, new Date());
  if (seeded.length > 0) deps.log.info("seeded first-run state", { tasks: seeded.join(", ") });
  await initScheduler(deps.taskManager, deps.tasks);
}
