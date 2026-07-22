# feat #582 — codex のターン境界を検知して活動フラグを立てる

対象 issue: https://github.com/receptron/mulmoterminal/issues/582
関連: #550 / #574（ターミナル間の会話受け渡し）、#254（Codex と Claude の差分）

## なぜ必要か

グリッドのセル状態は claude の hook（`/api/hook` → `activityHookEffects`）が立てている。`hookSettingsJson` は `spawn-claude.ts` からしか呼ばれず、**codex には hook 機構が無い**。結果 codex セルは永久に idle で、状態表示も注意喚起も鳴らず、#550 Phase 3 が必要とする「ターンが終わった」信号も存在しない。

## rollout が使えることは実測済み

| | |
|---|---|
| `task_complete` レコードの timestamp | `2026-07-22T02:23:54.907Z` |
| rollout ファイルの mtime | `2026-07-22T02:23:54.907461Z` |
| **フラッシュ遅延** | **0.5 ms** |

#254 が記録していたのは「rollout **ファイル**が最初のユーザーターンまで作られない」ことで、レコード単位の遅延ではなかった。

## 設計

### ポーリング（`fs.watch` は使わない）

`~/.codex/sessions` はユーザープロファイル配下。Windows で 8.3 短縮パスに `fs.watch` を張ると **libuv が `abort()` してプロセスごと落ちる**（catch 不能）。flush が 0.5ms なので 1秒ポーリング＋バイトオフセット追跡で十分。

### リプレイ防止（最重要）

`--resume` した rollout には過去のターンが全部入っている。オフセット 0 から読むと過去の `task_started` / `task_complete` を再生して嘘のフラグを立てる。

- **新規**セッション（`pickFreshSession` が新しく見つけた rollout）→ オフセット **0**
- **resume** → 監視開始時点の**ファイルサイズ**から

### ファイル構成

| ファイル | 役割 |
| --- | --- |
| `server/agents/codex-activity.ts` | **純関数** — 行分割（部分行の持ち越し）、読み取り範囲の決定（切り詰め検知）、ターン境界の抽出、hook イベント名への対応付け |
| `server/session/codex-activity-watch.ts` | ポーラー。I/O は全て DI |
| `server/session/spawn-codex.ts` | rollout id が判明した時点で監視を開始、pty が消えたら停止 |

境界は claude と**同じ `activityHookEffects` を通す**。「ターン境界がフラグに何をするか」の定義を1箇所に保つため。

- `task_started` → `UserPromptSubmit` 相当（working）
- `task_complete` → `Stop` 相当（done・未読）

## 非スコープ

- **`blocked`（承認待ち）の検知** — codex の承認プロンプトは rollout に現れない。working と done のみ
- Phase 3 の自動ループ本体

## テスト

純関数（`node:test` ではなく既存の vitest に合わせる）:

- 行分割: 部分行の持ち越し / 複数行 / 空 / 末尾改行あり・なし
- 読み取り範囲: 増加 / 変化なし / **縮小（切り詰め・ローテーション）**
- 境界抽出: `task_started` / `task_complete` / 両方 / 壊れた行混在 / `turn_context`（`payload.type` を持たない）を誤検知しない
- リプレイ防止: resume 開始時に過去のターンを再生しないこと

ポーラーは DI したフェイクで、境界が `onBoundary` に届くこと・停止後に呼ばれないことを確認する。
