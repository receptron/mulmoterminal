# feat #316 — ヘッダーに会話要約AIタイトルを表示

Umbrella #241 の子。#242（常時ステータスヘッダ）で導入したヘッダーの「直近 prompt 表示」を、
返答（follow-up）ターンでも意味を保つよう **会話要約 AI タイトル** に置き換える。

## 問題

セルヘッダー（`TerminalCell.vue` `headerText`）は現在「直近の *意味のある* user prompt」
（`server/transcript.ts` `preferredHeaderPrompt` が `isTrivialPrompt` で ack を弾いた last prompt）
をそのまま表示している。自己完結した命令なら良いが、会話が返答ベースになると破綻する：

- **trivial 判定の返答**（"はい" / "そっちで" / "お願い"）→ 弾かれて最初のタスクが残り続ける（stale）。
- **文脈依存な返答**（"2番目にして" / "さっきのを直して"）→ verbatim で出るが単体では意味不明。

根本原因は「単発 prompt では *今このセルが何をしているか* を表現できない」こと。

## スコープ（このPRのMVP）

会話の直近数ターン（user + assistant）を **安いモデル（Haiku）で要約** して短いヘッダータイトルを生成し、
既存の `ai-title` 読み口に乗せてヘッダーで優先表示する。

## 設計決定

- **保存 — in-memory。** Claude の transcript には書き込まない（外部 MulmoClaude の領域）。`lastPrompts` と
  同型の in-memory `aiTitles: Map<string,string>` を持つ。resume 時は既存の on-disk `ai-title`
  （`readSessionMeta` / `readSessionSummary` が読む）へフォールバック。in-memory が優先。
- **表示 — `aiTitle` 優先。** `headerText = aiTitle || lastPrompt || id`。`publishActivity` と
  `/api/session/:id` に `aiTitle` を追加。`readSessionMeta`（`/api/sessions` 一覧）は in-memory を
  on-disk aiTitle に上書き。
- **生成基盤 — `runClaudeHeadless` を流用。** `server/command-summary.ts` の `runClaudeHeadless` /
  `RunClaude` に任意の `model` を追加し、渡された時だけ `--model <model>` を argv に足す。新モジュール
  `server/header-title.ts` が「入力抽出 → プロンプト → 生成」を担い、この helper を注入で受ける（テスト用モック）。
  既定モデルは Haiku（`MT_TITLE_MODEL` env で上書き可）。非同期・timeout 付き・非ブロッキング。
- **入力 — 直近ターン。** `server/transcript.ts` に純粋関数 `recentTurnsFromJsonl(raw, maxTurns)` を追加し、
  末尾 N ターン（user/assistant のテキスト）を取り出す。`truncateLog` 同様にサイズ上限でキャップ。
- **言語 — 会話と同じ言語。** プロンプトで「会話と同じ言語で短いタイトルを」と指示（locale 配線は増やさない）。
  長さは短いタイトル（〜40字目安）。
- **生成頻度 — 必要時のみ。** 純粋関数 `shouldRegenerateTitle({ hasTitle, promptIsTrivial, turnsSinceTitle, maxTurns })`
  = `!hasTitle || promptIsTrivial || turnsSinceTitle >= maxTurns`。
  - `UserPromptSubmit`: ターン数を数え、上式で「再生成が必要」を判定してセッションに pending フラグを立てる。
  - `Stop`（assistant の返答が揃った時点）: pending なら transcript の直近ターンを読んで生成 →
    `aiTitles.set` → `publishActivity` → カウンタ/フラグをリセット。同一セッションの多重生成は in-flight
    セットで抑止。`maxTurns = TITLE_REGEN_EVERY_TURNS`（既定 5）。
- **後始末。** セッション teardown / `/clear`（SessionStart source=clear）で `aiTitles.delete(id)`
  （`lastPrompts` と同様）。

## ファイル

- `server/command-summary.ts` — `RunClaude` / `runClaudeHeadless` に任意 `model`（`--model`）を追加。
- `server/header-title.ts`（新）— `buildTitlePrompt` / `shouldRegenerateTitle` / `generateHeaderTitle`
  （`runClaude` 注入・model 既定 Haiku）。
- `server/transcript.ts` — `recentTurnsFromJsonl(raw, maxTurns)` を追加。
- `server/index.ts` — `aiTitles` マップ、`publishActivity` / `/api/session/:id` / `readSessionMeta` /
  `readSessionSummary` に aiTitle、hook ハンドラに生成トリガ、teardown/clear で delete。
- クライアント `src/components/TerminalCell.vue` — `aiTitle` ref、`ActivityMsg.aiTitle`、`applyActivity`、
  `headerText` を aiTitle 優先に。
- テスト: `server/header-title.spec.ts`（新）、`server/transcript.spec.ts`（recentTurns 追加）、
  `server/command-summary.spec.ts`（`--model` argv）、`src/components/TerminalCell.spec.ts`（aiTitle 優先）。
- `README.md` — ヘッダーAIタイトルと `MT_TITLE_MODEL` を記載。

## 非スコープ（後回し）

- タイトル生成の token コストを #245 のコストロールアップに算入。
- 「文脈依存だが trivial でない返答」の意味解析による能動検知（今回は trivial + N ターン周期でカバー）。
- 手動リフレッシュボタン（自動のみ。必要なら後付け）。
