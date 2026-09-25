// Where builds are kept: one directory per run under the server's home, NOT in the project the
// agent is working in, so nothing the build writes there can be read back as an approval
// (common/blueprint/state.ts says what that does and does not protect).
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { z } from "zod";
import { writeFileAtomic } from "../files/atomic-write.js";
import { blueprintRunSchema, RUN_ID_RE, type BlueprintRun } from "../../common/blueprint/run.js";
import { blueprintStateSchema, type BlueprintState } from "../../common/blueprint/state.js";

export interface RunStore {
  list(): Promise<string[]>;
  load(runId: string): Promise<{ run: BlueprintRun; state: BlueprintState } | null>;
  save(run: BlueprintRun, state: BlueprintState): Promise<void>;
}

// One file, written atomically: the run's bookkeeping (which session is working) and the step state
// must never be read from two different moments.
const BUILD_FILE = "build.json";

const buildFileSchema = z.object({ run: blueprintRunSchema, state: blueprintStateSchema });

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

export function createRunStore(rootDir: string): RunStore {
  const dirOf = (runId: string): string => path.join(rootDir, runId);
  return {
    async list() {
      const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);
      return entries.filter((entry) => entry.isDirectory() && RUN_ID_RE.test(entry.name)).map((entry) => entry.name);
    },
    async load(runId) {
      if (!RUN_ID_RE.test(runId)) return null;
      try {
        return buildFileSchema.parse(await readJson(path.join(dirOf(runId), BUILD_FILE)));
      } catch (err) {
        if (isMissing(err)) return null;
        throw new Error(`blueprint run ${runId} is unreadable: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
      }
    },
    async save(run, state) {
      await writeFileAtomic(path.join(dirOf(run.id), BUILD_FILE), `${JSON.stringify({ run, state }, null, 2)}\n`);
    },
  };
}

const isMissing = (err: unknown): boolean => err instanceof Error && "code" in err && err.code === "ENOENT";
