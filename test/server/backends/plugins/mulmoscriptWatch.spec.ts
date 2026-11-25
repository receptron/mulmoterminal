// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMulmoScriptWatch } from "../../../../server/backends/plugins/mulmoscriptWatch";
import { MULMOSCRIPT_SCOPE, pluginFileChannel } from "../../../../common/fileChannel";
import type { ScriptDirs } from "../../../../server/backends/plugins/mulmoscriptWatchRules";

const POLL_MS = 10;
// Long enough for several polls, so "nothing was announced" means the watcher looked and stayed quiet.
const QUIET_MS = 150;

const tmpDirs: string[] = [];
const stops: Array<() => void> = [];
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  tmpDirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The plugin's own save, made as its file ops make it: staged and renamed into place. An in-place
 *  write would let a poll catch the file emptied, a stamp no own write ever records. */
function pluginWrite(file: string, content: string): void {
  const staged = `${file}.staged`;
  fs.writeFileSync(staged, content);
  fs.renameSync(staged, file);
}

/** A wait the test opens and closes by hand, so a write can be put inside it deterministically. */
function heldGrace() {
  const pending: Array<() => void> = [];
  let opened = 0;
  return {
    wait: () =>
      new Promise<void>((resolve) => {
        opened += 1;
        pending.push(resolve);
      }),
    entered: () => opened > 0,
    opened: () => opened,
    /** Close the oldest wait still open. */
    release: () => pending.shift()?.(),
  };
}

/** A workspace with a default stories directory holding one story, and a watcher on it. */
function setup(ownWriteGrace?: () => Promise<void>) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mulmo-watch-"));
  tmpDirs.push(workspace);
  const storiesDir = path.join(workspace, "artifacts", "stories");
  fs.mkdirSync(storiesDir, { recursive: true });
  const deck = path.join(storiesDir, "deck.json");
  fs.writeFileSync(deck, '{"beats":[]}');
  const dirs: ScriptDirs = { storiesDir, rootDirs: new Map() };
  const published: string[] = [];
  let listener: ((channel: string, subscribed: boolean) => void) | null = null;
  const watch = createMulmoScriptWatch();
  stops.push(
    watch.start({
      pubsub: {
        onSubscriptionChange: (next) => {
          listener = next;
          return () => {
            listener = null;
          };
        },
      },
      dirs: () => dirs,
      roots: () => [workspace],
      publishChanged: (filePath) => published.push(filePath),
      pollMs: POLL_MS,
      ...(ownWriteGrace ? { ownWriteGrace } : {}),
    }),
  );
  const subscribe = (channel: string) => listener?.(channel, true);
  const unsubscribe = (channel: string) => listener?.(channel, false);
  return { workspace, deck, dirs, published, watch, subscribe, unsubscribe };
}

/** Wait until `done` holds, or give up after a while. */
async function until(done: () => boolean): Promise<void> {
  for (let waited = 0; !done() && waited < 2000; waited += POLL_MS) await sleep(POLL_MS);
}

/** Wait until something is announced, or give up after a while. */
async function announced(published: readonly string[]): Promise<void> {
  for (let waited = 0; published.length === 0 && waited < 2000; waited += POLL_MS) await sleep(POLL_MS);
}

describe("watching an open MulmoScript (#3014)", () => {
  it("announces an edit made outside the plugin, on the channel's own spelling", async () => {
    const { deck, published, subscribe } = setup();
    subscribe(pluginFileChannel(MULMOSCRIPT_SCOPE, "stories/deck.json"));
    await sleep(QUIET_MS);
    fs.writeFileSync(deck, '{"beats":[{"text":"edited outside"}]}');
    await announced(published);
    expect(published).toEqual(["stories/deck.json"]);
  });

  it("announces a story named by its absolute path", async () => {
    const { deck, published, subscribe } = setup();
    subscribe(pluginFileChannel(MULMOSCRIPT_SCOPE, deck));
    await sleep(QUIET_MS);
    fs.writeFileSync(deck, '{"beats":[{"text":"edited outside, absolute"}]}');
    await announced(published);
    expect(published).toEqual([deck]);
  });

  // The View that made this write recognises its own origin on the plugin's event. Announcing it
  // again without one would reload that View under the caret.
  it("says nothing about the plugin's own write, and still hears the next outside one", async () => {
    const { deck, dirs, published, watch, subscribe } = setup();
    subscribe(pluginFileChannel(MULMOSCRIPT_SCOPE, "stories/deck.json"));
    await sleep(QUIET_MS);
    pluginWrite(deck, '{"beats":[{"text":"typed in the View"}]}');
    watch.recordOwnWrite({ filePath: "stories/deck.json" }, dirs);
    await sleep(QUIET_MS);
    expect(published).toEqual([]);

    fs.writeFileSync(deck, '{"beats":[{"text":"then an editor rewrote it"}]}');
    await announced(published);
    expect(published).toEqual(["stories/deck.json"]);
  });

  it("recognises the plugin's own write named by a different spelling of the same file", async () => {
    const { deck, dirs, published, watch, subscribe } = setup();
    subscribe(pluginFileChannel(MULMOSCRIPT_SCOPE, "stories/deck.json"));
    await sleep(QUIET_MS);
    pluginWrite(deck, '{"beats":[{"text":"typed, saved by absolute path"}]}');
    watch.recordOwnWrite({ filePath: deck }, dirs);
    await sleep(QUIET_MS);
    expect(published).toEqual([]);
  });

  // A change is judged by the stamp that made the poll notice it. Reading the file again later
  // would see the plugin's next write in place of the outside edit and drop the edit as an echo.
  it("still announces an outside edit when the plugin writes again before the announcement", async () => {
    const grace = heldGrace();
    const { deck, dirs, published, watch, subscribe } = setup(grace.wait);
    subscribe(pluginFileChannel(MULMOSCRIPT_SCOPE, "stories/deck.json"));
    await sleep(QUIET_MS);
    fs.writeFileSync(deck, '{"beats":[{"text":"an editor wrote this"}]}');
    await until(grace.entered);
    pluginWrite(deck, '{"beats":[{"text":"then the View saved, longer than before"}]}');
    watch.recordOwnWrite({ filePath: "stories/deck.json" }, dirs);
    grace.release();
    await announced(published);
    expect(published).toEqual(["stories/deck.json"]);
  });

  // The plugin writes first and reports the write afterwards, so a poll can see its own edit
  // before the hook has recorded it. Announcing then would reload the View under its own caret.
  it("says nothing about the plugin's own write when the poll sees it before the hook records it", async () => {
    const grace = heldGrace();
    const { deck, dirs, published, watch, subscribe } = setup(grace.wait);
    subscribe(pluginFileChannel(MULMOSCRIPT_SCOPE, "stories/deck.json"));
    await sleep(QUIET_MS);
    pluginWrite(deck, '{"beats":[{"text":"saved by the View"}]}');
    await until(grace.entered);
    watch.recordOwnWrite({ filePath: "stories/deck.json" }, dirs);
    grace.release();
    await sleep(QUIET_MS);
    expect(published).toEqual([]);
  });

  // The wait outlives the watcher that started it. When the channel is dropped and subscribed again
  // meanwhile, the new watcher announces the change itself; the old one must not add a second.
  it("announces a change once when the channel is subscribed again during the wait", async () => {
    const grace = heldGrace();
    const { deck, published, subscribe, unsubscribe } = setup(grace.wait);
    const channel = pluginFileChannel(MULMOSCRIPT_SCOPE, "stories/deck.json");
    subscribe(channel);
    await sleep(QUIET_MS);
    fs.writeFileSync(deck, '{"beats":[{"text":"an editor wrote this"}]}');
    await until(grace.entered);
    unsubscribe(channel);
    subscribe(channel);
    await until(() => grace.opened() === 2);
    grace.release();
    await sleep(QUIET_MS);
    expect(published).toEqual([]);
    grace.release();
    await announced(published);
    await sleep(QUIET_MS);
    expect(published).toEqual(["stories/deck.json"]);
  });

  it("does not watch a file outside the roots it was given", async () => {
    const { published, subscribe } = setup();
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "mulmo-elsewhere-"));
    tmpDirs.push(elsewhere);
    const outside = path.join(elsewhere, "deck.json");
    fs.writeFileSync(outside, "{}");
    subscribe(pluginFileChannel(MULMOSCRIPT_SCOPE, outside));
    await sleep(QUIET_MS);
    fs.writeFileSync(outside, '{"changed":true}');
    await sleep(QUIET_MS);
    expect(published).toEqual([]);
  });

  it("ignores another plugin's channel and a path no story could be", async () => {
    const { deck, workspace, published, subscribe } = setup();
    const notes = path.join(workspace, "notes.md");
    fs.writeFileSync(notes, "# notes");
    subscribe(pluginFileChannel("markdown", deck));
    subscribe(pluginFileChannel(MULMOSCRIPT_SCOPE, notes));
    await sleep(QUIET_MS);
    fs.writeFileSync(deck, '{"beats":[{"text":"x"}]}');
    fs.writeFileSync(notes, "# notes, edited");
    await sleep(QUIET_MS);
    expect(published).toEqual([]);
  });
});
