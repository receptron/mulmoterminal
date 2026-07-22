# fix #574 — 💬 の受け渡しを pull 方向にする

対象 issue: https://github.com/receptron/mulmoterminal/issues/574
先行: #550 Phase 1 (PR #566)

## 何を直すか

PR #566 で入れた 💬 は **push**（A で押す → A のターンが B の入力欄へ）だった。実際に触ってもらったところ「ボタンを押したけど入力されてない」となった。動作は仕様どおりだが、**押した場所に結果が現れない**ので壊れて見える。

**pull** に変える: A で押して B を選ぶ → **B のターンが A の入力欄に入る**。

- 押したセルに結果が出る
- クリックも Enter も同じセルで完結する（push では宛先セルまで移動して Enter を押す必要があった）
- 宛先が常に自分なので、宛先が別グリッドページで見えない問題が消える
- 受け渡しテキストの文面（"Another terminal (…) just finished the exchange below. What do you think?"）は pull のほうが正しい — 読む本人が取り寄せたので

## 実装

| 変更 | 内容 |
| --- | --- |
| `useTerminalConnections.ts` | `SlotInfo` に `sessionId` を追加。他セルのログを読むのに要る。セッションが無いセルは一覧から落とす（読むログが無い） |
| `useHandoff.ts` | `HandoffTarget` が `source`（読む相手の session / cwd / agent）を持つ。`handoffLastTurn(source, destKey)` → `pullLastTurn(target, ownKey)` |
| `TerminalCell.vue` | `askCell(target)` は選ばれたセルから読み、自セルへ貼る。ボタン文言を pull 向きに |

サーバ側は変更なし — `GET /api/transcript/last-turn` は任意セッションを読めるので、どちらの向きでも同じ。

## テスト

- `pickHandoffTargets` が各セルの `sessionId` / `agent` を正しく載せること
- `pullLastTurn` が**選ばれたセルのログを読み、自セルへ貼る**こと（向きを逆にすると赤くなることを確認済み）
- 空・失敗・自セル未接続の各経路

## 非スコープ

- 往復時に引用が入れ子になる件（A が送ったテキストが B の `user_message` になるため）— 別途。実際に使ってから優先度を決める
