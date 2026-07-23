// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { Part } from "@google/genai";

import { extractImageResult, ALLOWED_IMAGE_MIME } from "../../../server/backends/imageResult.js";

const imagePart = (data: string, mimeType?: string): Part => ({ inlineData: { data, mimeType } });
const textPart = (text: string): Part => ({ text });

describe("extractImageResult", () => {
  it("returns the data + mime of a single image alongside its text", () => {
    const result = extractImageResult([imagePart("AAA", "image/jpeg"), textPart("a caption")]);
    expect(result).toEqual({ imageData: "AAA", mimeType: "image/jpeg", text: "a caption" });
  });

  // The desync bug embedded one part's bytes under another part's MIME; the fix must
  // keep the FIRST image's data and MIME together.
  it("adopts the FIRST image when several are present, not the last", () => {
    const result = extractImageResult([imagePart("FIRST", "image/png"), imagePart("SECOND", "image/webp")]);
    expect(result.imageData).toBe("FIRST");
    expect(result.mimeType).toBe("image/png");
    expect(result.imageData).not.toBe("SECOND");
  });

  it("falls back to image/png when the first image's MIME is outside the allowlist, keeping that same part's bytes", () => {
    expect(ALLOWED_IMAGE_MIME.has("image/svg+xml")).toBe(false);
    const result = extractImageResult([imagePart("DODGY", "image/svg+xml"), imagePart("SAFE", "image/png")]);
    expect(result.mimeType).toBe("image/png");
    expect(result.imageData).toBe("DODGY");
  });

  it("adopts the FIRST text when several are present", () => {
    const result = extractImageResult([textPart("first"), textPart("second")]);
    expect(result.text).toBe("first");
  });

  it("returns imageData undefined and the text when there is no image", () => {
    const result = extractImageResult([textPart("only words")]);
    expect(result.imageData).toBeUndefined();
    expect(result.mimeType).toBe("image/png");
    expect(result.text).toBe("only words");
  });

  it("leaves text undefined when no part carries text", () => {
    const result = extractImageResult([imagePart("AAA", "image/png")]);
    expect(result.text).toBeUndefined();
  });

  // An image part missing its data is not a usable image.
  it("ignores an inlineData part with no data", () => {
    const result = extractImageResult([{ inlineData: { mimeType: "image/png" } }, textPart("hi")]);
    expect(result.imageData).toBeUndefined();
    expect(result.text).toBe("hi");
  });

  // Empty string is falsy, matching the original truthiness check — an empty text part
  // must not shadow a later real one.
  it("skips an empty-string text part and takes the next real one", () => {
    const result = extractImageResult([textPart(""), textPart("real")]);
    expect(result.text).toBe("real");
  });

  it("returns imageData/text undefined and the PNG default for empty parts", () => {
    const result = extractImageResult([]);
    expect(result).toEqual({ imageData: undefined, mimeType: "image/png", text: undefined });
  });
});
