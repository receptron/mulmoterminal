# fix: `/clear` やセル内 `/resume` の後に Restart すると、別の会話に戻る (#3325)

## 症状（報告 → 手元で再現）

報告者の原因分析は使わず、症状から再現した。origin/main を使い捨ての `HOME` と専用の tmux で起動し、
引数を記録するだけのスタブを `CLAUDE_BIN` にして、hook は `POST /api/hook` で送る。Restart はボタンと
同じ経路（`POST /api/session/:id/terminate` → 同じ id で `/ws` に再接続）。何が resume されたかは
サーバのログ `[ws] client connected (resume|new <id>)` と、スタブが受け取った引数で判定した。

| 手順 | Restart 後の引数 | 戻った会話 |
|---|---|---|
| A. 会話 → `/clear` → 1 回送信 → Restart | `--resume <自分の id>` | `/clear` で終えた会話 |
| B. 会話 → セル内 `/resume` で別の会話へ → 送信 → Restart | `--resume <自分の id>` | 元の会話（選んだ会話ではない） |
| B'. 最初の送信の前に `/resume` → 送信 → Restart | `--session-id <新しい id>` | 空の新規セッション（セルの id も変わる） |

アイドル reap 後に開き直す場合と、`/exit` 後に開き直す場合も reap を通るので、A と同じ道筋になる。

## 原因（コードを辿って確認）

```text
Restart → POST /terminate → reap()                       server/session/lifecycle.ts
            → forgetClearedTranscript(id)                ← 凍結の印を消す（A）
        → /ws?session=<id> → resolveClaudeSession()      server/routes/ws-routes.ts
            → cleared = clearedTranscripts.has(id)       ← もう false
            → resolveSession()                           server/session/list/session-resolve.ts
            → resume = <id>  → `--resume <id>`           ← 凍結された transcript
```

- **A**: 凍結の印（`cleared-transcripts/<id>.json`）は `/clear` の時点で作られるが、reap が消す。
  消す理由のコメントは「次の claude はこの id のファイルに追記し直すから」だが、#2013 以降、
  印がある id のファイルを resume することはもう無いので、その理由はもう成り立たない。
- **B / B'**: セル内 `/resume` は `/clear` と同じく、claude を自分の id とは別の transcript へ
  移す。ところが移った先の id は、メモリ上の `claudeSessionIds` にしか残らない（reap で消える）。
- **共通の欠け**: 印があっても、`resolveSession` は「resume しない」と決めるだけで、**移った先の
  会話を resume する**ことはしない。#2013 は「別の提案」としてこれを見送っていた。したがって
  印を残すだけでは A は「古い会話の復活」から「空の新規セッション」に変わるだけで、
  セルが表示していた会話には戻らない。

## 本物の claude での確認（手順 0、Claude Code 2.1.292 で実施）

使い捨てのディレクトリと、絶対パスを指定した tmux ソケットで、ログイン済みの本物の claude を
動かした。渡したのは、`SessionStart` / `UserPromptSubmit` の payload と、その時点の各 `.jsonl` の
サイズを記録する hook。報告者の環境は 2.1.326 なので、版の違いは残る。

| 操作 | 届く `SessionStart` | ファイル |
|---|---|---|
| `--session-id S` で起動 | `source=startup`, `session_id=S` | — |
| `/clear` | `source=clear`, `session_id=<新しい id>` | 新しいファイルができる。**古いファイルにも `cost-state` 行が追記される** |
| `/compact` | `source=compact`, `session_id` は**変わらない** | 同じファイルに追記。移らない |
| セル内 `/resume` で別の会話を選ぶ | `source=resume`, `session_id=<選んだ id>` | 選んだファイルに追記。**離れた側のファイルにも `cost-state` 行が追記される** |
| `--resume X` で起動 | `source=resume`, `session_id=X`（**X のまま**） | X に追記 |

- 方針 1（後継を `--resume` し、自分の id は hook の `x-mt-session` で保つ）は成り立つ。
- `/compact` は範囲外でよい。id もファイルも変わらない。メモリにあった「`/compact` でも id が
  変わる」は、この版では当てはまらない。

### 新しく見つかった原因 C: 印が次の boot で捨てられる

`cost-state` の追記は、**`/clear` の hook が呼ばれた後**に来る。古いファイルが伸びるまでの時間を
hook の中から測ると、hook の開始より後だった。サーバが印に書くサイズは hook を受けた時点の
`stat` なので、追記前の値になる。

実際のサーバ（origin/main）に、本物の claude の hook を本物と同じ `curl` で送って確かめた:

1. `/clear` をセル id を変えて繰り返す。どの回も、印のサイズが `/clear` 直後のファイルより小さい
2. サーバを再起動 → `hydrateClearedTranscripts` が `markStillHolds` で **すべて捨てた**
3. そのセルに再接続 → `[ws] client connected (resume <id>)`、つまり `/clear` 前の会話を resume

つまり #2013 の修正は、tmux ごと消える再起動（PC の再起動、Windows の psmux）では効いていない。
しかもこれは reap を通らない。上の方針 2・3 だけを入れても、サーバを再起動すれば印は消える。

## 方針

**セッションの「今の会話」がどの transcript にあるかを、永続する事実として 1 か所に持ち、
spawn がそれを resume する。** その事実はすでに凍結の印（`ClearedMark.claudeId`）が持っている。
足りないのは (1) 印を消さないこと、(2) `/resume` でも印を書くこと、(3) その id を resume すること。

| | 決定 | 理由 |
|---|---|---|
| 1. 後継の resume | `resolveSession` に `successorOnDisk`（印の `claudeId` の transcript がディスクにあるか）を足し、`cleared && successorOnDisk` なら `resume = 後継`、`sessionId = requested` のまま | spawn 側（`spawnClaudePty(sessionId, resume)` → `claude-args.ts`）は id と resume 先を別々に受け取れる作りになっている。hook は `x-mt-session` で自分の id に紐づくので、セルの id は変わらない。決定はすでに純関数に切り出されているので、そこに足す |
| 後継がディスクに無い | 従来どおり（tmux が生きていれば id を維持、死んでいれば新しい id） | `/clear` の後に 1 回も送信していない場合。失う会話が無い |
| 2. reap | 印を**消さない** | Restart は reap と spawn の 2 段で、その spawn が印を読む。印のある id は resume されないので、ファイルは凍結されたまま |
| 3. セル内 `/resume` | `SessionStart source=resume` で、claude が名乗る id が「自分の id」でも「印に記録済みの後継」でもなければ、`/clear` と同じ印を書く（後継 = その id） | 2 つ目の除外が無いと、1 の resume で起きた claude が同じ hook を出すたびに印を書き直し、ヘッダーが毎回消える |
| 自分の会話に `/resume` で戻った | `source=resume` で claude の id が自分の id なら、**印を消す** | ファイルに追記が再開されるので凍結ではなくなる。残すと次の Restart が古い後継へ行く。boot 時のサイズ検査で消えるのはサーバ再起動のときだけなので、ここで消す必要がある |
| 4. 印の掃除 | boot 時の hydrate で「自分の transcript も後継の transcript も、無いと**確定した**」印だけを消す（`mark-prune.ts`）。無いと確定するのは `ENOENT` / `ENOTDIR` のときだけ | reap が掃除役でなくなるので、溜まらないようにする。後継だけある印は残す（最初の送信の前に `/clear` / `/resume` したセルには自分のファイルが無い）。権限エラーや I/O エラーはファイルの有無を何も言わないので、それで消すと後継を永久に失う |
| 5. サイズによる失効（原因 C） | **サイズ検査をやめる**（案 (a)）。印が失効するのは「自分の id へ `/resume` で戻った」（hook の `unmark`）と、4 の掃除だけ。`hydrateClearedTranscripts` は `markStillHolds` を呼ばない | サイズ検査は「誰かがこのファイルを resume し直した」を見るためのものだった。この修正の後は、こちらから自分の id を resume することは無く、セル内で戻る場合は hook で分かる。見えなくなるのは、ユーザーが別の端末で `claude --resume <自分の id>` した場合だけで、そのときは Restart が後継へ行く（受け入れる）。却下した案 (b)（追記された行の種類を読んで、会話の行があるときだけ失効させる）は、他のプログラムのファイルを読む処理が一つ増えるわりに、救うのがこの一件だけ |
| 印の `size` | どのファイルも届かない値（`MARK_SIZE_NEVER_REACHED`）を書く。読む側は使わない | 同じ home を古い版のサーバが読むと、`parseClearedMark` は `size` を必須にし、さらにファイルがそれより大きければ印を消す。`cost-state` の追記で必ず大きくなるので、実際のサイズを書くと古い版が消してしまう。古い版の reap が印を消すことだけは、古い側のコードなので防げない |
| 印の書き込みと削除の順序 | 同じ id の印のディスク操作は、呼ばれた順に一つずつ行う | 印を書く途中で自分の id への `/resume` が届くと、削除の後に書き込みが着地して印が復活し、次の boot で後継へ戻ってしまう |

hook 側の判定は純関数にする（`server/session/transcript/` に置く）:

```ts
type ConversationMove = "mark" | "unmark" | "none";
// source, 自分の id, claude が名乗った id, 印に記録済みの後継 → どうするか
conversationMove({ source, sessionId, claudeId, recordedSuccessor }): ConversationMove
```

- `clear` → `mark`（現状どおり）
- `resume` かつ claudeId が無い / 形が不正 → `none`
- `resume` かつ claudeId === sessionId → 印があれば `unmark`、無ければ `none`
- `resume` かつ claudeId === recordedSuccessor → `none`
- `resume` かつそれ以外 → `mark`
- `compact` / `startup` / その他 → `none`（手順 0: `/compact` は id もファイルも変えない）

## 手順

0. ~~本物の claude で前提を確かめる~~ 済み（上の「本物の claude での確認」）。
1. `conversationMove` を純関数で切り出し、hook ルート（`hook-routes.ts` / `header-hook.ts`）を通す。
   テストは両方向（正常の各分岐 + id 無し・不正な形・null・source 不明）。
2. `resolveSession` に `successorOnDisk` を足す。`resolveClaudeSession` は `clearedClaudeIdOf` と
   `sessionExistsOnDisk` で事実を集める。純関数の全組合せをテスト。
3. `reap()` から `forgetClearedTranscript` を外す。`lifecycle.spec.ts` の期待を逆にする。
4. `restoreMark` から `markStillHolds` を外し、「自分も後継も transcript が無ければ消す」を足す。
   `cleared-transcripts.ts` 冒頭の「サイズで自然に失効する」説明も、この形に書き直す。
5. `yarn format` → `yarn lint` → `yarn build` → `yarn typecheck` → `yarn test`。
6. **再現スクリプトで A / B / B' を実際に走らせ直し**、Restart 後の引数が `--resume <後継>`、
   セルの id が変わらないことを確認する。加えて、アイドル reap の場合と、**本物の claude で
   `/clear` → サーバ再起動（tmux も消す）→ 再接続**の場合（原因 C）も見る。後者は手順 0 と同じ
   仕掛け（本物の hook を本物と同じ `curl` でサーバに送る）で、印が boot を越えて残ることまで確かめる。

## 確認してほしいこと（PR の Items to Confirm に載せる）

- **セル内 `/resume` の直後に、ヘッダー・タイトル・transcript ビューが空になる**。印を読む側
  （`transcript-view-read.ts` の `status: "cleared"`、タイトル、サマリー、プロンプトペイン）は、
  印のある id を「空」として扱い、後継の transcript を読みには行かない。`/clear` の直後と同じ
  見え方になる。今は `/resume` の後に元の会話の内容が出ている（それはそれで間違い）。
- **起動フォームの resume 一覧で、凍結された id を選んだ場合**。今は新しい id で空の状態から
  始まる。この修正の後は後継の会話に行く。「終えた会話を選んだら最新の会話に行く」で良いか。
- 印は reap では消えず、boot 時の掃除だけになる。
- 後継の有無は、印に記録した cwd ではなく、再接続の cwd で調べる。claude は起動した cwd の project ディレクトリから `--resume` 先を探すので、そこに無いものは resume できない（自分の transcript の確認と同じ決まり）。
- サイズによる失効をやめたので、別の端末で `claude --resume <自分の id>` した後の Restart は後継へ行く。

## やらないこと

- **印を読む側が後継の transcript を読むようにすること**（上の 1 つ目の確認事項を根本から直す）。
  読む側は複数あり（transcript ビュー、タイトル、サマリー、push、プロンプトペイン、リモートの
  セッション一覧）、「この id の今の会話はどのファイルか」を 1 つの関数にまとめる別の変更になる。
  別 issue に切り出す。
- 凍結された transcript そのものの削除（#2013 と同じく別の話）。
