// @vitest-environment node
import { describe, it, expect } from "vitest";

import { rawServingPlan } from "../../../server/backends/rawServingPlan.js";

const KB = 1024,
  MB = 1024 * KB;

describe("rawServingPlan — content type", () => {
  it.each([
    ["/w/a.png", "image/png"],
    ["/w/a.JPG", "image/jpeg"],
    ["/w/a.svg", "image/svg+xml"],
    ["/w/a.pdf", "application/pdf"],
    ["/w/a.mp4", "video/mp4"],
    ["/w/a.json", "application/json; charset=utf-8"],
  ])("maps %s to %s", (p, ct) => {
    expect(rawServingPlan(p, 1).contentType).toBe(ct);
  });

  it("falls back to octet-stream for an unknown extension", () => {
    expect(rawServingPlan("/w/a.xyz", 1).contentType).toBe("application/octet-stream");
    expect(rawServingPlan("/w/noext", 1).contentType).toBe("application/octet-stream");
  });
});

describe("rawServingPlan — the sandbox boundary", () => {
  // The security-relevant branch, and the one the route's single .png test never exercised.
  // An SVG can carry inline <script>; served without the sandbox it runs in the app origin.
  it("sandboxes an SVG", () => {
    expect(rawServingPlan("/w/x.svg", 1).sandbox).toBe(true);
  });

  it("sandboxes an image, a text file, and an unknown type", () => {
    for (const p of ["/w/x.png", "/w/x.txt", "/w/x.xyz"]) expect(rawServingPlan(p, 1).sandbox).toBe(true);
  });

  // The deliberate exception — and the only one. WebKit won't render a sandbox-opaque PDF.
  it("does NOT sandbox a PDF", () => {
    expect(rawServingPlan("/w/x.pdf", 1).sandbox).toBe(false);
  });

  it("still sandboxes everything that is not a PDF", () => {
    for (const p of ["/w/x.mp4", "/w/x.json", "/w/x.gif"]) expect(rawServingPlan(p, 1).sandbox).toBe(true);
  });
});

describe("rawServingPlan — the size cap", () => {
  // Audio/video get 500 MiB (Range-streamed); everything else 25 MiB.
  it("lets a 400 MiB video through but 413s a 30 MiB image", () => {
    expect(rawServingPlan("/w/x.mp4", 400 * MB).tooLarge).toBe(false);
    expect(rawServingPlan("/w/x.png", 30 * MB).tooLarge).toBe(true);
  });

  it("holds an image right at the 25 MiB cap", () => {
    expect(rawServingPlan("/w/x.png", 25 * MB).tooLarge).toBe(false);
    expect(rawServingPlan("/w/x.png", 25 * MB + 1).tooLarge).toBe(true);
  });

  it("413s a video only past 500 MiB", () => {
    expect(rawServingPlan("/w/x.webm", 500 * MB).tooLarge).toBe(false);
    expect(rawServingPlan("/w/x.webm", 500 * MB + 1).tooLarge).toBe(true);
  });

  // An audio file is media too, not a generic file on the small cap.
  it("gives audio the media cap", () => {
    expect(rawServingPlan("/w/x.mp3", 100 * MB).tooLarge).toBe(false);
  });
});
