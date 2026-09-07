# fix: MulmoTerminal からピン留めしたコレクションに色が付かない (#1995)

## 問題

MulmoTerminal からピン留めすると、そのエントリだけ `color` が付かない。共有ファイルを読む
MulmoClaude 側のランチャーで、そのピンだけアクセント色が無い状態で並ぶ。

原因は `src/components/PinToggle.vue` の props が `{kind, slug, title, icon}` しか宣言しておらず、
それをそのまま `pin()` に渡していたこと。**プラグインは色を渡している** — 同じ `pinToggle` スロットに
登録されている MulmoClaude 側のコンポーネントは `color?: string` を受け取っている。

#1993（書き込みのたびに色が消える）と同じ族で、あちらが「持っていた色を消す」、こちらが
「最初から付けない」。#1993 で共有型に `color?: string` が入ったので、その上に乗るだけ。

## 決めたこと

| 論点 | 決定 | 理由 |
|---|---|---|
| 直し方 | props に `color?: string` を足し、`pin()` に渡す | プラグインは既に渡している。受け取っていなかっただけ |
| 色が無いとき | **キー自体を出さない**（条件付き spread） | `color: undefined` はオブジェクトにキーとして残り、共有ファイルでは `null` になる。相手側に「無視の仕方」を要求しない |
| 検証 | しない | #1993 と同じ理由。パレットを持っているのは描く側 |
| UI | 触らない | MulmoTerminal は色を描かない |

## 実装

- `src/components/PinToggle.vue` — props に 1 行、`pin()` に条件付き spread。
- `test/src/components/PinToggle.spec.ts`（新規） — 色を渡すと乗ること / 無いときはキーが出ないこと /
  unpin は識別子だけで色に関係しないこと。1 本目は修正を外すと落ちる。

## 確認すること

- MulmoTerminal でピン留め → MulmoClaude のランチャーで、index を開き直さなくても色が付いていること。
