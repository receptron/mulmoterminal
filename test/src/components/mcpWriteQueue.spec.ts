import { describe, it, expect } from "vitest";
import { createMcpWriteQueue } from "../../../src/components/mcpWriteQueue";

// Each tool-group switch POSTs to /api/gui-mcp-groups, which shells out to `claude mcp add/remove` —
// a read-modify-write of one config file. Only the flipped group's own checkbox is disabled while
// it saves, so ticking render and media in quick succession fires two writes at once and one
// registration is lost while both switches show "on". The queue is what stops that.
describe("the MCP write queue", () => {
  const deferred = () => {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  it("does not start the second write until the first has finished", async () => {
    const queue = createMcpWriteQueue();
    const first = deferred();
    const started: string[] = [];

    const a = queue(async () => {
      started.push("render");
      await first.promise;
    });
    const b = queue(async () => {
      started.push("media");
    });

    // The second write must still be waiting while the first is in flight.
    await Promise.resolve();
    expect(started).toEqual(["render"]);

    first.resolve();
    await a;
    await b;
    expect(started).toEqual(["render", "media"]);
  });

  // A failed write reports itself (the checkbox goes back); it must not take the queue with it,
  // or one server error would silently drop every later registration.
  it("runs the next write after one fails", async () => {
    const queue = createMcpWriteQueue();
    const started: string[] = [];

    const failing = queue(async () => {
      started.push("render");
      throw new Error("HTTP 500");
    });
    const after = queue(async () => {
      started.push("media");
    });

    await expect(failing).rejects.toThrow("HTTP 500");
    await after;
    expect(started).toEqual(["render", "media"]);
  });

  // Each caller awaits its OWN write. A rejection travelling down the chain would surface on an
  // unrelated later caller, which would then put the wrong checkbox back.
  it("does not reject a later write with an earlier one's failure", async () => {
    const queue = createMcpWriteQueue();
    queue(async () => {
      throw new Error("HTTP 500");
    }).catch(() => {});
    await expect(queue(async () => {})).resolves.toBeUndefined();
  });
});
