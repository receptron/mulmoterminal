// The link menu's labels live in five locale files that nothing else compares (the main tables
// are each at their line cap, so these sit apart): a key added in one and not the others shows the
// key's name on screen in that language. Pin the five to the same key set.
import { describe, it, expect } from "vitest";
import { fileLinksEn } from "../../src/i18n/fileLinks/en";
import { fileLinksJa } from "../../src/i18n/fileLinks/ja";
import { fileLinksKo } from "../../src/i18n/fileLinks/ko";
import { fileLinksZhCN } from "../../src/i18n/fileLinks/zh-CN";
import { fileLinksZhTW } from "../../src/i18n/fileLinks/zh-TW";

type Messages = { readonly [key: string]: string | Messages };

const keyPaths = (messages: Messages, prefix = ""): string[] =>
  Object.entries(messages).flatMap(([key, value]) => (typeof value === "string" ? [`${prefix}${key}`] : keyPaths(value, `${prefix}${key}.`)));

const locales: ReadonlyArray<[string, Messages]> = [
  ["ja", fileLinksJa],
  ["ko", fileLinksKo],
  ["zh-CN", fileLinksZhCN],
  ["zh-TW", fileLinksZhTW],
];

describe("the file-link labels", () => {
  it.each(locales)("are the same keys in %s as in English", (_locale, messages) => {
    expect(keyPaths(messages).sort()).toEqual(keyPaths(fileLinksEn).sort());
  });
});
