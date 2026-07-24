// @vitest-environment node
import { describe, it, expect } from "vitest";
import { spawnCollect } from "../../../server/git/spawn-collect.js";

describe("spawnCollect", () => {
  it("resolves ok:true with stdout for a successful command", async () => {
    const r = await spawnCollect(process.execPath, ["-e", "process.stdout.write('hello')"], { errorStderr: "spawn failed" });
    expect(r).toEqual({ ok: true, stdout: "hello", stderr: "" });
  });

  it("resolves ok:false with captured stderr for a non-zero exit", async () => {
    const r = await spawnCollect(process.execPath, ["-e", "process.stderr.write('boom'); process.exit(3)"], { errorStderr: "spawn failed" });
    expect(r.ok).toBe(false);
    expect(r.stderr).toBe("boom");
  });

  it("resolves ok:false with errorStderr when the binary can't be spawned", async () => {
    const r = await spawnCollect("definitely-not-a-real-binary-xyz", ["--version"], { errorStderr: "gh not found" });
    expect(r).toEqual({ ok: false, stdout: "", stderr: "gh not found" });
  });

  // Regression (#743): the child writes a multibyte UTF-8 string as two byte-halves across a
  // delay, forcing a chunk boundary INSIDE the character. Per-chunk toString() corrupted it
  // into replacement chars; decoding the concatenated buffer once keeps it intact.
  it("decodes multibyte UTF-8 split across stdout chunk boundaries", async () => {
    // '日' is E6 97 A5. Emit E6 then (after a tick) 97 A5, so the first chunk ends mid-char.
    const script = "const b=Buffer.from('日本語','utf8'); process.stdout.write(b.subarray(0,1)); setTimeout(()=>process.stdout.write(b.subarray(1)), 30);";
    const r = await spawnCollect(process.execPath, ["-e", script], { errorStderr: "spawn failed" });
    expect(r.ok).toBe(true);
    expect(r.stdout).toBe("日本語");
    expect(r.stdout).not.toContain("�"); // no replacement character
  });

  it("kills a command that exceeds the timeout and resolves ok:false", async () => {
    const r = await spawnCollect(process.execPath, ["-e", "setTimeout(()=>{}, 60000)"], { errorStderr: "spawn failed", timeoutMs: 150 });
    expect(r.ok).toBe(false);
  });
});
