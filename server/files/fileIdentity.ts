// Whether two looks at a path saw one file. bigint, always: a Windows file id is 64 bits — a sequence
// number over a record number — and above 2^53 a JS number drops the low bits, so two DIFFERENT files
// in a busy folder can report the same `ino` as a number (#3496).
import type { BigIntStats } from "node:fs";

export type FileIdentity = Pick<BigIntStats, "dev" | "ino">;

export const isSameIdentity = (a: FileIdentity, b: FileIdentity): boolean => a.dev === b.dev && a.ino === b.ino;
