# Node の必要バージョン表記を 22.12 に揃える (#1986)

## 経緯

PR #1982 が `puppeteer` を 25.10.0 に上げ、その engine 要件に合わせて `package.json` の
`engines.node` を `>=22.9` → `>=22.12` に変えた（`0f6309b4`）。`puppeteer` は
`dependencies` にあるので、この要件はエンドユーザの install にそのまま効く。

人に伝えている側（README / ガイド / `init` の doctor）は 22.9 のまま残った。

## 直す対象

| ファイル | 箇所 |
| --- | --- |
| `bin/cli-args.js` | `MIN_NODE_MINOR = 9` → `12` |
| `test/bin/cli-args.spec.ts` | 境界のアサーションを 22.12 基準に。加えて `engines.node` との一致を固定 |
| `README.md` | Node ≥ 22.9 の 4 箇所 |
| `docs/index.md` | 日本語段落・英語段落の 2 箇所 |
| `docs/guide/{en,ja}/getting-started.md` | 冒頭・前提表・ステップ 1 の版数 |
| `docs/guide/{en,ja}/faq.md` | 必要環境の行 |
| `docs/guide/{en,ja}/index.md` | 「Node ≥ 22.9 があれば」の行 |

## 触らないもの

- `docs/guide/{en,ja}/v*.md` と `docs/ChangeLog.md` — 公開時点のスナップショットなので書き換えない
- `engines.node` 自体 — これが正であるという前提で他を揃える

## 再発防止

今回の食い違いは、`package.json` と `bin/cli-args.js` のどちらか一方だけを変えても
何も落ちないから起きた。`MIN_NODE_LABEL` が `package.json` の `engines.node` が名指す
バージョンと一致することを spec で固定し、次に engine を上げた人には赤で伝わるようにする。

`engines.node` は `>=x.y` 形式なので、spec 側でその形を parse して `MIN_NODE_LABEL` と
突き合わせる。形が変わったら（`^` やレンジになったら）spec が落ちるので、それも気づける。
