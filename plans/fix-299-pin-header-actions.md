# fix #299: expand/close を常にヘッダー右上に固定

## 現象
grid view でヘッダー1行目の情報（`name` バッジ / git ブランチ / model / ctx /
トークン）が増えると、右上の expand（⤢）と close（✕）が押し出されて見切れる。

## 原因
`.cell-header` は flex。情報チップ群は `flex: 0 0 auto` で縮まないため、
`cell-prompt`（`flex: 1 1 auto; min-width: 0`）が 0 まで潰れ、`cell-dir` が
`min-width: 16ch` に達した後は、超過分が最後の `.cell-actions` を右へ押し出す。
`.cell { overflow: hidden }` により押し出された部分がクリップされ、ボタンが消える。

## 修正
情報部分を 1 つのトラックに包み、アクションをその外に出す:

```
.cell-header  (flex)
├── .cell-header-main  flex: 1 1 auto; min-width: 0; overflow: hidden   ← 幅の圧力を吸収
│     dot / dir / badge / git / diff / model / usage / prompt
└── .cell-actions      flex: 0 0 auto                                    ← 常に右上
      expand(⤢/⤡) / close(✕)
```

- `.cell-header-main` は `min-width: 0` で内容より小さくなれる → 溢れた情報チップは
  トラック内でクリップされる（ボタンより左で切れる）。
- `.cell-actions` は縮まず、押し出されもしない。

`.cell-header` に直接子セレクタは無かったため、CSS の他への影響なし。
`onHeaderClick` の `closest("button")` 判定もラッパー追加の影響を受けない。

## テスト
`TerminalCell.spec.ts`: 情報（dir / prompt）が `.cell-header-main` 内にあり、
`.cell-actions` はその兄弟（`.cell-header > .cell-actions`）で、expand/close を
含むことを検証。
