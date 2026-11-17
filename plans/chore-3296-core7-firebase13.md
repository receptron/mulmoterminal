# @mulmoclaude/core 7 を取り込み、Node 24.15 以上にする (#3296)

## 目的

#3296（音声入力が無音・雑音から「ご視聴ありがとうございました」を入力する）に対し、上流は
`@mulmoclaude/core@7.2.0` で `WHISPER_SERVER_EXTRA_ARGS` を足した（receptron/mulmoclaude#3671）。
MulmoTerminal の宣言は `^6.0.1` なので届かない。これを取り込む。

`createWhisper` が自分で環境変数を読むので、MulmoTerminal 側のコード変更は無い。

## core 7 が連れてくるもの

- core 7.0.0 の破壊的変更は、optional な peer `firebase` が `^13.0.0` だけになったこと。
- core を peer に持つプラグイン 7 本が、それに合わせて major を上げている（中身は peer 範囲だけ）:
  accounting / chart / google 6.0.0、collection / html / markdown / mulmoscript 7.0.0。
- firebase 13 は Node 24.12 以上が要る。MulmoClaude はこれで Node 22 を打ち切った（#3650,
  `^24.15.0 || >=26.0.0`）。

## 決めたこと

- **Node の下限は 24.15**（MulmoClaude と同じ数字）。形は今の `>=major.minor` のまま `>=24.15`。
  MulmoClaude は奇数の 25 を外しているが、`bin/cli-args.js` の判定と、`engines.node` との一致を
  固定している spec はどちらも下限一つを前提にしている。25 を外すのは今回の目的の外。
- **firebase は `13.4.0` に固定する（キャレット無し）。** 固定は #1731 の方針（`@firebase/auth`
  1.13.4 がポップアップでのログイン後に資格情報を保存できなかった）。13.4.0 が持つ
  `@firebase/auth@1.13.11` の dist に、その原因の「`hidden` をページ終了とみなす」処理が無いことを、
  今の 1.13.6 と比べて確かめた。
- **`@receptron/sharedapp` は 0.47.2 に上げる（receptron/sharedapp#124）。** 0.47.1 の peer は
  `^5.4.0 || ^6.0.0` で、core 7 と並べると npm が `ERESOLVE` で install を止める（手元で再現）。
  sharedapp 側で `|| ^7.0.0` を足して公開し、こちらはその版に上げる。
- CI は PR を 22 → 24、Windows の日次を `[24.x, 26.x]` にする。

## 直す場所

- `package.json`: 依存、`engines.node`
- `bin/cli-args.js` の `MIN_NODE_*`、`test/bin/cli-args.spec.ts` の境界
- `docs/facts.json` の `requires.node`
- README（5 言語）、`docs/index.md`、ガイド en/ja の getting-started / faq / index / remote / feature-list
- `.github/workflows/` の Node 指定
- 新しい環境変数: README の表、FAQ（en/ja）に「話していないのに入力される」項目

## 触らないもの

- `docs/ChangeLog.md` と `docs/guide/*/v*.md` — 公開時点のスナップショット
- `blueprints/` と、ガイドの blueprints / from-collection の Node 22.13 — 利用者が作るアプリの要件

## 確かめられないこと

- 手元に `whisper-server` が無く、`--vad` の効果と、受け付けない指定で起動しなくなる挙動は
  見ていない（上流の説明に拠る）。
- firebase 13 での Google ログイン（リモートホスト）は、実際のポップアップを通していない。
