# fix #2011 — codex の user ターン record 型変更に prompt-history / last-turn が追従していない

## 症状（実測、HTTP ルート経由）

| ルート | 新形式 rollout (2026-09) | 旧形式 rollout (2026-08 前半) |
| --- | --- | --- |
| `GET /api/transcript/prompts` | `{"prompts":[],"truncated":false}` | プロンプトが並ぶ |
| `GET /api/transcript/last-turn` | `prompt: null` / reply あり | prompt・reply とも あり |

同一サーバ・同一設定での対照なので、差は rollout の record 型だけ。
ハンドオフのテキストは `--- their prompt ---` ブロックごと落ち、受け取った側は
「返答だけで質問が無い」ものを読むことになる。

## 原因

#1962 と同じ根。codex はユーザーターンを

- 旧: `type: "event_msg"` / `payload.type: "user_message"`（`payload.message` が本文）
- 新: `type: "response_item"` / `payload.type: "message"` / `role: "user"`（`payload.content[].text`）

へ移した。#2009 で `server/agents/codex-sessions.ts` は両形式を読むようにしたが、
**同じ record を読む残り 2 箇所**が旧形式のまま:

- `server/session/prompt-history.ts:142`
- `server/session/last-turn.ts:88`

`~/.codex/sessions` 6,334 rollout の実測で、2026-09 は 171/171、2026-08 は 1,945/5,715 が
旧 record を持たない = 履歴ペインが空になる。2026-07 以前は 0 件。

## 修正

規則が 3 箇所に散らないよう、**判定を 1 本にして 3 箇所から使う**。

新規 `server/agents/codex-user-turn.ts`（純関数のみ）:

```ts
codexUserPrompt(doc: Record<string, unknown>): string | null
```

- 両形式の user ターンからテキスト part 群を取り出す
- codex 自身の合成前置きは **メッセージ単位で捨てる**（`<environment_context>` /
  `<recommended_plugins>` / `<user_action>` / `<turn_aborted>`。タグを持たない
  `# AGENTS.md instructions for …` part が同じメッセージに同居するため part 単位では落とせない）
- 残った最初のテキストを返す。無ければ null

### 途中で見つかったこと: 旧 rollout はプロンプトを **2 回** 書いている

両形式を読むようにした最初の版を差分テストにかけたら、**旧形式 762 件のうち 748 件で
プロンプトが 2 倍**になった。実測すると codex は 1 年ほどの間、1 つのプロンプトを

1. `response_item`（モデルへ送る側）
2. **その直後の record** で `event_msg`（同じテキスト）

の 2 回書いていた。サンプル 1,095 rollout で **924 組すべてがこの順序・record 間隔 1** で、
両者のテキストが食い違う例は 0 件。

したがって「両方読む」だけでは全プロンプトを収集する読み手（履歴ペイン）が二重計上する。
一方で **28 件のプロンプトは `event_msg` にしか存在しない**（2026-07 の 14 rollout）ので、
旧 record を捨てるだけでも駄目。

規則: **直前の record が同じテキストの `response_item` だったときに限り `event_msg` を捨てる**。
形と隣接の両方を見るので、人が同じ文言を 2 回送った場合（同じ形・間に応答がある）は collapse しない。
落とす側を `event_msg` にしたのは、上記 28 件を残すため。

`last-turn.ts` と `codex-sessions.ts` は最初の 1 件しか取らないので、この重複は無関係。
よって dedupe は `prompt-history.ts` の fold 側に置き、ペアの事実（`isDoubleWrite`）だけを
共有モジュールに置く。

呼び出し側:

- `codex-sessions.ts` — 自前の private コピーを削除して import（**振る舞いは不変**）
- `prompt-history.ts` の `foldCodexPrompt` — `codexUserPrompt` に差し替え。
  時刻は現状どおり `epochMs(record.timestamp)`（新形式 `response_item` も同じトップレベルに
  ISO の `timestamp` を持つことを確認済み）
- `last-turn.ts` の `codexPromptForTurn` — `eventPayload(doc, "user_message")` を差し替え。
  `task_started` / `task_complete` は現行 rollout にも残っているので、ターンの位置スパンの
  取り方は変えない

## 検証（「同じ挙動」は走らせて示す）

1. **抽出の振る舞い保存**: `codex-sessions.ts` は純粋な抽出なので、#2009 で使った
   codex 自身の `threads.first_user_message` との差分テストを全 rollout で再実行し、
   一致数が変わらないことを示す。
2. **旧形式で不変・新形式で回復**: 修正前後の `codexPrompts` / `lastTurnFromCodexRollout` を
   1,096 rollout（2026-08 以外は全件、2026-08 は 12 件に 1 件）に対して走らせて比較した結果:

   | | rollout | 結果 |
   | --- | --- | --- |
   | 旧 record あり | 762 | **変化 0 件**（prompts / last-turn の prompt・reply すべて一致） |
   | 旧 record なし | 334 | **333 件が 0 → 回復**、残り 1 件は本当にプロンプトが無い（`<turn_aborted>` だけの中断セッション） |

   last-turn の prompt が付かない新形式 4 件は、いずれも `task_complete` が無い未完了ターン
   （「実行中のターンは飛ばす」という既存の仕様どおり）。
3. **実機**: サーバを起動して 2 つのルートを新旧両方の rollout に対して叩き、
   ハンドオフ本文に prompt ブロックが戻ることを確認する。
4. ミューテーションで新テストが赤くなることを確認する。

## この PR に入れないもの

- `codex-activity-track.ts` は `task_started` / `task_complete` を見ており、これらは現行 rollout にも
  残っているので壊れていない。触らない。
- transcript ビュー（`transcript-view-read.ts`）は codex のログを読んでいない。対象外。
