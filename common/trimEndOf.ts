// A string without the characters of a set at its end — `trimEnd` for characters other than spaces.

/** `text` without any of `chars` at its end. Measured in UTF-16 units, as `slice` is. */
export function trimEndOf(text: string, chars: ReadonlySet<string>): string {
  let end = text.length;
  while (end > 0 && chars.has(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end);
}
