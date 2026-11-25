// "The same file, unchanged": device, file id, size and modification time. From bigint stats, because
// a Windows file id is 64 bits and a JS number drops its low ones, so two different files can share an
// `ino` as a number (#3496). The time in nanoseconds for the same reason: bigint stats carry no fraction.
import type { BigIntStats } from "node:fs";

export type StampedStats = Pick<BigIntStats, "dev" | "ino" | "size" | "mtimeNs">;

export const fileStamp = ({ dev, ino, size, mtimeNs }: StampedStats): string => `${dev}:${ino}:${size}:${mtimeNs}`;
