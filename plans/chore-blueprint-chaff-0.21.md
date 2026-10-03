# chaffjs 0.21 (#2891)

The document blueprints' pin moves from chaffjs 0.18 to 0.21 in `checks/chaff.sh`, the workspace skill, the style
report skill, adopt's workflow template (and the spec that pins its text), and the genre list's comment.

Compared with 0.18, run over every preset document with and without `--experimental`, and the polish and adopt
presets again under the genre each one passes:

- the genre list, `--help`'s `chaff feedback`, `cite`, and the fields the checks read from `rules --json`, `tree` and
  SARIF are unchanged (`tree` only adds `attrs.placement`);
- `max-sentence-length` is `info` now, and its limit is set per genre. polish and adopt act only on `error` and
  `warning`, so the presets that existed to split long sentences — polish `oshirase` and `tejun`, adopt
  `help-pages` — had nothing left to do;
- a run without `--experimental` now also reports the structure rules, date / total mismatches, sentence rhythm and
  katakana long vowels. review already ran with `--experimental`, so its findings do not change.

So each of those presets keeps its long sentence and gains one finding that fits the document and that 0.21 reports
as a warning under the preset's genre:

- `oshirase.md` — 「言うまでもなく」 (empty-intensifier);
- `tejun.md` — a 「[こちら]」 link to the IC card history (vague-link-text);
- `login.md` — a 「[こちら]」 support link (vague-link-text);
- `export.md` — 「見れます」 (ra-nuki).

Their descriptions (presets.json and the English locale) no longer promise to split long sentences, and neither does
`english-blog`'s, whose long sentence is `info` now too.

`step-reference-missing` would have suited `tejun.md` better, but 0.21 does not ship it yet.
