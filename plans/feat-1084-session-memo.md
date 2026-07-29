# feat(session): セッションごとの手書きメモ (#1084)

## 何を作るか

セッションに、ユーザーが手で書く 1 行メモを持たせる。セルヘッダに常時表示し、
セッション ID に紐づけてサーバに保存する。

複数セッションを並べていると、どのセルが何をやっているのか分からなくなる。いまヘッダに出る 1 行は
`cellHeaderText()` が返す AI タイトル → 直近プロンプト → session id の先頭 8 桁で、どれも
「エージェントが何を言ったか」であって「自分がこのセルを何のために開いたか」ではない。

## 決めたこと

| 論点             | 決定                                                                       |
| ---------------- | -------------------------------------------------------------------------- |
| ヘッダの見た目   | メモがある時は**既存の 1 行を置き換える**。タイトルは `title` 属性に退避。行は増えない |
| 保存単位         | セッション ID 単位、サーバ保存                                             |
| 寿命             | **reap しても消さない**。resume すれば戻る。サーバ再起動も跨ぐ             |
| スコープ         | セルヘッダ＋スマホのロスター＋サイドバーの一覧まで                         |

## 保存の形

`~/.mulmoterminal/session-memos.jsonl` — 1 行 1 レコードの**追記ログ**。

`session-id-log.ts` / `dev-terminal-cwds.ts` と同じ理由で追記にする。MULMOTERMINAL_HOME はマシン上の
全サーバで 1 つで、ランチャがポート衝突で 2 つ目を起こすのは普通の運用。スナップショットを書くと
read-merge-write になり、同時に書いた 2 インスタンスは片方の内容を失う。追記は read が要らない。

- 1 行 = `{"id":"...","text":"...","at":<ms>}`。JSON なので引用符・記号・多言語がそのまま往復する。
- 同じ id の**最後の行が勝つ**。`text` が空の行は「消した」の意味で、読み戻しでマップから消える。
- 読み込みは `forEachJsonlRecord()` でストリーム。ファイル全体を 1 つの文字列にしない
  （CLAUDE.md「Reading files」）。書き手は人間の編集だけなので実際には小さいが、上限は無い。

## 触るところ

### common

- `common/sessionMemo.ts` — `MEMO_MAX_LENGTH` と `normalizeMemo()`。クライアントは入力欄の
  `maxlength` とプレビューに、サーバは書き込み時の強制に使う。両側が同じ答えを出す必要があるので common。
  改行・制御文字は空白に潰す（1 行だから）、trim、上限で切る。

### server

- `server/session/session-memos.ts` — 追記ログの純粋な読み書き（`sessionMemoLine`, `parseSessionMemos`）。
- `server/session/registry.ts` — `sessionMemos` マップ、hydrate、追記ライタ、`setSessionMemo()`。
- `server/routes/session-routes.ts` — `POST /api/session/:id/memo`（`{ text }` → 正規化 → 保存 → publish）。
- `server/session/activity-transition.ts` — `sessionRow` に `memo`。
- `server/session/lifecycle.ts` — `publishActivity` が memo を載せる（他のタブ・スマホに即反映）。
- `server/session/session-detail-view.ts` — `GET /api/session/:id` に `memo`。
- `server/session/sessionListTitle.ts` — サイドバー行のタイトルの**最上位**にメモ。
- `server/index.ts` — スマホのロスター行（`remoteHostListTerminalSessions`）のタイトルの最上位にメモ。

スマホ側は `TerminalSessionSummary.title` をそのまま描くだけなので、**`title` に載せる**ことで
core のリリースもスキーマ変更も無しにメモが出る。新しいフィールドを足しても今のスマホは読まない。

### src

- `src/components/cellActivity.ts` — `ActivityPush.memo` / `CellActivityState.memo`、
  `cellHeaderText(memo, aiTitle, lastPrompt, id)`。memo の absent / null は aiTitle と同じ規約
  （absent = 変更なし、null = 今は無い）。
- `src/components/TerminalCell.vue` — memo の ref、ヘッダのアイコンボタンでインライン編集
  （Enter 確定 / Esc 取消 / blur 確定）、セッション切り替えでリセット、POST。

## テスト

- `normalizeMemo` — 改行・タブ・制御文字、前後空白、上限切り、非文字列、空。
- 追記ログ — 最後の行が勝つ / 空で消える / 不正 id を落とす / 壊れた行を飛ばす / 記号と多言語の往復。
- `cellHeaderText` — memo が最優先、空メモは素通り、既存の 3 段は不変。
- `applyActivityPush` — memo の absent = 据え置き、null = クリア。
- `sessionListTitle` — memo が live AI タイトルより上、空は素通り。
- `sessionDetailView` — memo の受け渡し。
- `sessionRow` — memo あり / 無し。

## やらないこと

- 複数行メモ・Markdown・履歴。1 行に閉じる。
- キーマップからの起動。ヘッダのボタンのみ。
