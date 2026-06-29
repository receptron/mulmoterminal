# feat: diff パネルの「Commit」ボタン（Claude にコミットさせる）

Issue: #113（Umbrella #108 / 取り込みの続き #110）

## ねらい
diff パネルに未コミット変更（`dirty>0`）があるとき **[✓ Commit]** で Claude にコミットさせ、取り込みフローを繋ぐ。
完成フロー: **dirty → [✓ Commit] → Claude がコミット → ahead↑/dirty↓ → [⬆ Push] → [⧉ Open PR]**

## 実装（サーバ変更なし）
- `Terminal.vue` の既存 `submitText(text)`（PTY にプロンプト投入＋送信、paste 対策の遅延 CR）を再利用。
- `TerminalCell.vue`:
  - フッタ先頭に **[✓ Commit]**。`dirty>0` かつ `!working`（作業中は割り込まない）かつ `!prBusy` で有効。
  - click → `termRef.submitText(COMMIT_PROMPT)`。送信できたら "Asked Claude to commit…"、ws 不通なら "Couldn't reach the session"。
  - コミット後の diff 更新は既存の `watch(working)`→`loadDiff()` が担う（追加処理なし）。
- テスト: dirty>0 で有効・click で `submitText` をプロンプト付きで呼ぶ／dirty=0 や working 中は disable／submitText が false のときのメッセージ。

## 非対象
コミットメッセージの GUI 入力、マージ/破棄、node_modules 戦略。
