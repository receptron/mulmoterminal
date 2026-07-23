// @vitest-environment node
import { describe, it, expect } from "vitest";

import { missingRequiredEnv, serverToolEnabled, soleExecutor } from "../../../server/infra/server-tool-load.js";

const env = (obj: Record<string, string>) => obj as NodeJS.ProcessEnv;

describe("missingRequiredEnv", () => {
  it("is empty when a tool needs nothing", () => {
    expect(missingRequiredEnv(undefined, env({}))).toEqual([]);
    expect(missingRequiredEnv([], env({}))).toEqual([]);
  });

  it("names every var that is absent", () => {
    expect(missingRequiredEnv(["A", "B", "C"], env({ B: "set" }))).toEqual(["A", "C"]);
  });

  // An env var present but empty is still "not set" — a blank token cannot run the tool.
  it("treats an empty value as missing", () => {
    expect(missingRequiredEnv(["A"], env({ A: "" }))).toEqual(["A"]);
  });
});

describe("serverToolEnabled", () => {
  // The gate: a credential-less tool must be dropped so claude never calls one it can't run.
  it("enables a tool only when all its env vars are set", () => {
    expect(serverToolEnabled(["X_TOKEN"], env({ X_TOKEN: "t" }))).toBe(true);
    expect(serverToolEnabled(["X_TOKEN"], env({}))).toBe(false);
  });

  it("enables a tool that needs no env at all", () => {
    expect(serverToolEnabled(undefined, env({}))).toBe(true);
  });

  it("is disabled when even one of several is missing", () => {
    expect(serverToolEnabled(["A", "B"], env({ A: "set" }))).toBe(false);
  });
});

describe("soleExecutor", () => {
  const fn = () => 1;

  it("picks the one execute* export", () => {
    expect(soleExecutor({ executePresentForm: fn, TOOL_DEFINITION: {} })).toBe(fn);
  });

  // Two execute* exports is ambiguous — pick neither rather than guess.
  it("returns undefined when two execute* functions exist", () => {
    expect(soleExecutor({ executeA: fn, executeB: () => 2 })).toBeUndefined();
  });

  it("returns undefined when there is none", () => {
    expect(soleExecutor({ TOOL_DEFINITION: {}, helper: fn })).toBeUndefined();
  });

  // Only a function counts — an `executeConfig` object export must not be chosen.
  it("ignores an execute* export that is not a function", () => {
    expect(soleExecutor({ executeConfig: { a: 1 } })).toBeUndefined();
  });

  it("matches on the execute prefix, not a bare name", () => {
    expect(soleExecutor({ runExecute: fn })).toBeUndefined();
  });
});
