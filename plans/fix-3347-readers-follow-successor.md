# fix: 会話が移ったセルを、印を読む側が「空」と表示する (#3347)

## 症状

#3340 (#3325) から、`/clear` とセル内 `/resume` はどちらもセッションに印（`cleared-transcripts/<id>.json`）を付け、
移った先の id（`claudeId`、後継）を記録する。Restart はこの後継を `--resume` する。ところが印を読む側は、
印のある id を「空」として扱うだけで後継を読まない。セル内 `/resume` で既存の会話に移ると、その会話の
内容がヘッダー・タイトル・transcript ビュー・push・リモート一覧のどこにも出ない。`/clear` の後も、後継の
会話に送信した後まで空のまま。

## 方針（issue の案 1）

**「このセッションの今の会話はどの transcript にあるか」を 1 つの純関数で決め、「今の会話」を読む側を
すべてそこに通す。**

```ts
// server/session/transcript/current-transcript.ts（純関数）
currentTranscriptId(id, { cleared, successor }): string | null
//   印が無い           → id
//   印あり・後継あり   → successor
//   印あり・後継なし   → null（読むものが無い = 空）
```

`cleared-transcripts.ts` に、メモリ上の印を渡すだけの `transcriptIdOf(id)` を置く。読む側は
`clearedTranscripts.has(id)` で分岐する代わりに、`transcriptIdOf(id)` が返した id のファイルを読み、
null のときだけ今の「空」を返す。セッションに紐づく状態（タイトル、メモ、活動、カーソル）は今までどおり
セッションの id で持つ。変わるのは、どのファイルを読むかだけ。

後継のファイルの場所は `claudeTranscriptFile(cwd, successor)` に任せる。後継の id はどのアカウントにも
紐づかないので、`readHome` がすべてのホームを探す（#3340 で確認済み）。

## 対象にする読む側

| 場所 | 今 | 変更後 |
|---|---|---|
| `transcript-view-read.ts`（transcript ビュー） | 印があれば `status: "cleared"` | 後継のファイルを読む。null のときだけ `cleared` |
| `session-title.ts`（AI タイトル） | 印があればタイトルを作らない | 後継のファイルからタイトルを読む／作る |
| `task-push.ts`（push の本文） | 印があれば transcript を読まない | 後継のファイルから返答を読む |
| `lifecycle.ts`（最後の返答の読み直し） | 印があれば読み直さない | 後継のファイルを読み直す |
| `session-routes.ts`（`/api/session`） | 印があれば transcript の値を使わない | 後継のファイルの要約を使う（バッジも後継の会話のもの） |
| `hook-routes.ts`（ヘッダーのプロンプトの初期値） | 印があれば初期値を取らない | 後継のファイルから取る |
| `session-reads.ts`（プロンプト一覧の予備の経路） | 印があれば空 | 後継のファイルを読む |
| `hostSessionList.ts`（リモート一覧） | 印があればタイトルを読まない | 後継のファイルから読む |
| `session-routes.ts` のツールの経過（`/api/transcript/timeline`）と最後のやり取り（`/api/transcript/last-turn`、別のセッションへの貼り付け） | 印を見ずに凍結されたファイルを読む（同じ種類の不具合） | 後継のファイルを読む。ルートで `transcriptIdOf` を引く |
| `task-push.ts` が使う `claudeCurrentTurnReply` | 印のある id は読まなかった | 後継の id で呼ぶ（エージェントの判定はセッションの id のまま） |

## 決めたこと

| | 決定 | 理由 |
|---|---|---|
| `/clear` の直後、後継のファイルがまだ無い間 | 空のまま | 後継のファイルが無いので、読んでも空になる。issue の決めることの 2 つ目 |
| 凍結された元の会話を transcript ビューで見せるか | 見せない（この変更の範囲外） | issue の決めることの 3 つ目。別の変更で決める |
| 印を付けた直後のヘッダー | 後継の transcript から最後のプロンプトと返答を入れる。読めなければ `""` | 今は `""` を入れるので、`/resume` の後は次の送信まで空になる。`/clear` の後継は中身が無いので、結果は今と同じ `""` |
| `sessionCost`（`cost.ts`） | 変えない | セッションの費用を「今の会話」と「セッション全体」のどちらで数えるかは別の判断 |
| ws の再接続（`ws-routes.ts`） | 変えない | #3340 で後継を resume する決定はすでに入っている |

## 手順

1. `current-transcript.ts`（純関数）とテスト（両方向）。`transcriptIdOf` を `cleared-transcripts.ts` に。
2. 上の表の読む側を一つずつ `transcriptIdOf` に通す。各 spec の「印があれば空」の期待を、後継があるとき・
   無いときの 2 つに分ける。
3. 印を付けるときに、ヘッダーへ後継の最後のプロンプトと返答を入れる。`/clear` の後継は中身が無いので空になり、`/clear` と `/resume` で分岐しない。
4. `yarn format` → `yarn lint` → `yarn build` → `yarn typecheck` → `yarn test`。
5. 使い捨ての `HOME` でサーバを起動し、セル内 `/resume` → `/api/session` と transcript ビューが後継の
   内容を返すこと、`/clear` 直後は空、後継に送信した後はその内容、を実際に確かめる。

## 確認してほしいこと（PR の Items to Confirm）

- `/api/session` のバッジ（使用量・コンテキスト）が、移った後は後継の会話の値になる。
- `/clear` で離れた会話は、どの画面からも見えなくなる（ファイルは残る）。

## やらないこと

- `sessionCost` の数え方。
- 凍結された会話を見せる UI。
- #3348（古い版のサーバが同じ home の印を消す）。
