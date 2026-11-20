// Writing one memory's text over the same memory in another work copy of the repository (#3331), so
// the copies hold one text again — over the text that copy had when it was read, and with an Undo
// that puts that text back while nothing has changed it since.
import { ref } from "vue";
import { loadLibraryMemoryFile, saveLibraryMemoryFile } from "./libraryApi";
import { sessionRunningIn } from "../components/library/memorySessions";

export interface WorkCopyTarget {
  slug: string;
  file: string;
  name: string;
  cwd: string | null;
}

export type WorkCopyNotice =
  { kind: "written"; name: string; running: boolean; undoFailed?: boolean } | { kind: "same" | "changed" | "failed" | "undone" | "undo-changed"; name: string };

interface Written {
  target: WorkCopyTarget;
  before: string;
  version: string;
}

/** `changed` runs after a copy was written or put back, to judge the copies again. */
export function useWorkCopyWrite(changed: () => void) {
  const notice = ref<WorkCopyNotice | null>(null);
  /** One write or undo at a time: the Undo kept is the last write's, and never another's. */
  const busy = ref(false);
  let written: Written | null = null;

  async function oneAtATime(task: () => Promise<void>): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    try {
      await task();
    } finally {
      busy.value = false;
    }
  }

  const writeThere = (target: WorkCopyTarget, text: string): Promise<void> => oneAtATime(() => write(target, text));

  async function write(target: WorkCopyTarget, text: string): Promise<void> {
    written = null;
    const there = await loadLibraryMemoryFile(target.slug, target.file);
    if (there?.text == null || typeof there.version !== "string") {
      notice.value = { kind: "failed", name: target.name };
      return;
    }
    if (there.text === text) {
      notice.value = { kind: "same", name: target.name };
      return;
    }
    const [saved, running] = await Promise.all([saveLibraryMemoryFile(target.slug, target.file, text, there.version), sessionRunningIn(target.cwd)]);
    if (saved.kind !== "saved") {
      notice.value = { kind: saved.kind, name: target.name };
      return;
    }
    written = { target, before: there.text, version: saved.version };
    notice.value = { kind: "written", name: target.name, running };
    changed();
  }

  /** The copy's own text back, over the text written there — not over a change made to it since. */
  const undo = (): Promise<void> => oneAtATime(undoLast);

  async function undoLast(): Promise<void> {
    const last = written;
    if (last === null) return;
    const saved = await saveLibraryMemoryFile(last.target.slug, last.target.file, last.before, last.version);
    if (saved.kind === "saved") {
      written = null;
      notice.value = { kind: "undone", name: last.target.name };
      changed();
    } else if (saved.kind === "changed") {
      written = null;
      notice.value = { kind: "undo-changed", name: last.target.name };
    } else notice.value = { kind: "written", name: last.target.name, running: false, undoFailed: true };
  }

  const dismiss = (): void => {
    written = null;
    notice.value = null;
  };
  return { notice, busy, writeThere, undo, dismiss };
}
