# Guide videos

The launch demo, embedded at the top of both language indexes (`../en/index.md`, `../ja/index.md`) and — the English one — in the repository README under `## Demo`.

Captured from the same **throwaway demo instance** the screenshots use — a scratch `HOME` and neutral demo projects (`acme-web`, `acme-api`, `acme-docs` under `mt-demo`), so no personal session data appears. Read every frame before committing a new one; the rules and the traps are in [`../images/README.md`](../images/README.md).

| File | Length | Size | Shows |
|---|---|---|---|
| `launch-demo-en.mp4` | 1:32 | 3.3 MB | One agent, then a grid of them — **working / done / needs you** in colour, the cockpit roster holding what each session asked and answered, and picking whichever cell is lit. English narration |
| `launch-demo-ja.mp4` | 1:34 | 3.4 MB | The same footage, Japanese narration. The screen is the English one — only the voice differs |

Both are 1280x720, h264 + aac.

**Each embed carries a transcript of the narration** in a `<details>` block right under the player (README, `en/index.md`, `ja/index.md`). The text is the narration as rendered — copied verbatim from the MulmoScript deck that produced the cut, `mulmo-presentations/mulmoterminal/launch/mulmoterminal-launch-v8.json` and `…_ja.json`, checked against the `script` that mulmocast embedded in the render's `_studio.json` (the deck file can be edited after a render; the studio copy is what was spoken). **`launch-demo-{en,ja}.vtt` are the same narration as WebVTT captions**, one cue per beat, wired into each guide's `<video>` as `<track kind="captions">` (the README's GitHub player cannot take a track, so there only the transcript is available). The cue times come from the deck's render record, `output/<deck>/<deck>_studio.json`: a cue starts at the beat's `startAt` plus `audioParams.introPadding` (the movie opens with that much silence and `startAt` does not include it) and ends `audioDuration` later, when the voice stops. mulmocast writes `startAt` only when the **movie** step runs, and `mulmo pdf` rewrites the studio file without it — so if the times are missing, run the movie step again (cached TTS and frames make that a few minutes of assembly) before regenerating; `record-youtube-publish`'s `youtube-chapters.js` reads the same fields and stops when the studio file cannot be trusted. Sanity check after generating: the last beat's `startAt + duration + introPadding + outroPadding` must equal the mp4's duration — here 91.638 s and 93.536 s, both exact.

**The same two cuts are also GitHub user-attachments**, which is what the repository README embeds (`0b8dd582-…` for English, `055daa6b-…` for Japanese — the URLs are in [#1827](https://github.com/receptron/mulmoterminal/issues/1827)). GitHub renders such a URL as an inline player from a bare line of Markdown; a `<video>` tag pointed at a file in this directory is what works on the Pages site. Re-cut the video and **both** copies need replacing — and the three transcripts and two `.vtt` files with them if a word of the narration or its timing changed.

The copies here are **not byte-identical to the attachments**: they were remuxed with `ffmpeg -c copy -movflags +faststart`, which moves `moov` to the front so a browser can draw the first frame without first range-requesting the tail of the file. Same streams, same frames, same byte count — only the atom order differs. Do that to any replacement too:

```bash
ffmpeg -i <cut>.mp4 -c copy -movflags +faststart docs/guide/videos/launch-demo-<lang>.mp4
```
