import { describe, it, expect } from "vitest";

import { isOpenablePluginUrl } from "../../../src/composables/pluginUrlPolicy";

describe("isOpenablePluginUrl", () => {
  it.each([["https://example.com"], ["http://example.com/path?q=1"], ["https://sub.example.com:8443/x#y"]])("allows the http(s) URL %s", (url) => {
    expect(isOpenablePluginUrl(url)).toBe(true);
  });

  // The whole reason this exists: a plugin view runs LLM-authored markup, and its openUrl
  // hands the argument to window.open. Each of these executes or exfiltrates in the app
  // origin if it gets through.
  it.each([
    ["javascript:alert(1)"],
    ["JavaScript:alert(1)"],
    ["  javascript:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["file:///etc/passwd"],
    ["vbscript:msgbox(1)"],
    ["blob:https://example.com/uuid"],
  ])("refuses the dangerous scheme %j", (url) => {
    expect(isOpenablePluginUrl(url)).toBe(false);
  });

  // An unparseable string must be refused, not handed to window.open to interpret.
  it.each([[""], ["not a url"], ["///"], ["http:"], ["example.com"], ["//example.com"]])("refuses the unparseable or scheme-relative %j", (url) => {
    expect(isOpenablePluginUrl(url)).toBe(false);
  });

  // mailto/tel are not opened in a tab here — only http(s). Recorded so widening the set is a
  // deliberate choice.
  it.each([["mailto:a@b.com"], ["tel:+123"], ["ssh://host"]])("does not open the non-web scheme %j", (url) => {
    expect(isOpenablePluginUrl(url)).toBe(false);
  });
});
