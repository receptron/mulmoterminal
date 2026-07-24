# fix: tmux の OSC52 クリップボード転送が壊れている（#740）

## User Prompt

> mulmoclaude で全ファイルをレビューして pure 関数化できる部分は関数化しつつバグを探したら結構なバグがあったんだけど、こっちでもできる？
> （全ファイルレビューで検出したバグを issue 化し、順に対応・CI・レビュー対応・マージまで進める）

## 症状

tmux 経由のセッションで Claude Code の自動コピー（OSC 52）がブラウザのクリップボードに届かず、
代わりに `E]52;c;<base64>` という文字列がターミナルに表示される。

## 原因

`server/infra/tmux.ts` の conf 行がダブルクォートを使っていた。

```ts
`set -ag terminal-overrides "${OSC52_MS_OVERRIDE}"`   // OSC52_MS_OVERRIDE = ",*:Ms=\\E]52;%p1%s;%p2%s\\007"
```

tmux はダブルクォート内でエスケープ処理を行うため `\E` が食われて素の `E` になり、`\007` は生の BEL になる。
tmux 3.6a で実測して確認：

| 書き方 | tmux が保存する値 |
|---|---|
| ダブルクォート（旧） | `*:Ms=E]52;%p1%s;%p2%s<BEL>`（壊れ） |
| シングルクォート | `*:Ms=\E]52;%p1%s;%p2%s\007`（正） |
| argv 直渡し（live パス） | `*:Ms=\E]52;%p1%s;%p2%s\007`（正） |

初回起動（tmux サーバ未起動）は必ず conf 経由なので標準的な使い方でこの経路に入る。
さらに `applyLiveTmuxOptions` のガード `includes("Ms=")` は壊れた値にもマッチするため自動修復されなかった。

## 修正

1. conf 行をシングルクォートにして tmux に `\E` をそのまま渡す。
2. `OSC52_MS_OVERRIDE` の本体を `MS_OVERRIDE_ENTRY` として切り出し export。
3. `planMsOverride(showStdout)` を純粋関数として追加。
   実行中サーバの `show -g terminal-overrides` 出力から `append` / `ok` / `replace(index)` を判定する。
   壊れた値を保存済みの既存サーバ（このfix以前に起動）はインデックス指定 set で修正する。
4. `applyLiveTmuxOptions` を「Ms= を含むか」ではなく `planMsOverride` の結果で分岐するよう変更。

## テスト

`test/server/infra/tmux.spec.ts`:
- conf 行がシングルクォートで、ダブルクォートを含まないこと（回帰）。ダブルクォートに戻すと落ちることを確認済み。
- `planMsOverride`: append（未設定）/ ok（正しい値）/ replace（壊れた値を保存済み）/ 他人の override は無視、を実 tmux 出力フィクスチャで固定。

実 tmux 3.6a に修正後 conf を読ませ、`Ms=\E]52;...` が正しく保存されることをエンドツーエンドで確認。
