# feat: Claude Code のチャット間メッセージで使う名前をセルに出す (#3237)

## 問題

Claude Code は同じマシンの別のセッションに SendMessage で送れる。宛先は ListAgents が返す名前
（`myrepo-66`）で、セッション ID（GUID）とは別物。MulmoTerminal はこの名前をどこにも出さないので、
宛先のセルを見分けるには宛先のセルで「一覧を出して」と頼むしかなかった。

## 名前の出どころ

Claude Code 自身が `<Claude のホーム>/sessions/<pid>.json` に書いている（2.1.292 で確認）。

- `name`: ListAgents の名前。`nameSource` は `derived` のほか `user` / `peer` / `auto` / `collision` / `hook`
  があり得るので、名前は計算せず読む。
- `tmux`: `mt-<MulmoTerminal のセッション ID>:@0.%0`。tmux のセッション名は MulmoTerminal が付けたもの
  （`tmuxSessionName(id)`）なので、セルとの対応はこれで引ける。
- `sessionId`: Claude 自身のセッション ID。起動時は MulmoTerminal の ID と同じで、`/clear` や
  `/compact` で変わる。tmux の欄が無いとき（tmux なしの起動）の予備。
- `pid`、`updatedAt`: 生きていない pid の項目は読まない。同じセルを名乗る項目が複数あれば
  `updatedAt` の新しい方。

## 決めたこと（ユーザーと）

1. 既定で出す。邪魔にならないように小さなアイコンだけ。押すと名前をコピーし、カーソルを重ねると
   名前と説明が出る。
2. ロスターの行にも同じ小さなボタンを出す。
3. セッション ID は出さない。
4. 2 つ目の契約（accounts）は、既存の `agentHomeChoices("claude")` でホームを列挙するだけなので対応する。

## 形

- `server/agents/claude/claude-peers.ts`（純粋）: 項目の読み取り `parseClaudePeer`、tmux の欄から
  セッション名を取る `tmuxSessionOf`、セルの名前を決める `peerNameFor`。
- `server/agents/claude/claude-peer-registry.ts`: 各ホームの `sessions/` を読み、生きている pid だけ残す。
  短い TTL で結果を共有し、9 セルが同時に問い合わせても読むのは一度。
- `GET /api/session/:id` が `peerName`（Claude 以外は `null`）を返す。`/clear` の規則とは無関係なので
  `sessionDetailView` の外に置く（`collection` と同じ扱い）。
- クライアント: `SessionMetaView.peerName`（明示的な `null` が勝ち、欄が無ければ据え置き）、
  `CockpitRow.peerName`、セルは詳細の取得で `peerName` を取り込む。
- 組み込みチップ `peer`（`CELL_CHIP_IDS` と `BUILTIN_CHIPS` に追加、既定の並びの末尾）。
  `PeerNameChip.vue` は名前が無ければ何も描かない。ロスターの行の見出しの右端にも置く。
- 起動直後のセルは、Claude が自分を登録する前に最初の詳細取得が終わるので、答えが明示的な `null` の
  間は間を空けて数回だけ聞き直す（`PEER_NAME_RETRIES`、`PEER_NAME_RETRY_MS`）。登録しない古い
  Claude Code でも、いちばん忙しい経路を叩き続けない。
- 記録の読み取りの守り（Codex の第 1 ラウンド）: 読むのは `<pid>.json` と名付けられた通常ファイルだけ
  （`lstat`、シンボリックリンクは追わない。隣の `.key` は送信の秘密）、`MAX_ENTRY_BYTES` を超える
  ファイルは開かず、一つのフォルダから読むのは `MAX_ENTRIES` 件まで、読み取りは一件ずつ。
- フォルダの一覧も有限（第 2 ラウンド）: `fs.opendir` で少しずつ読み、項目名が `MAX_ENTRIES` 件になるか
  名前を `MAX_SCANNED` 個見た時点で止める。項目でない名前で埋まったフォルダを最後まで読まない。

## 範囲外

- 名前を MulmoTerminal から付け直すこと（Claude Code 側の操作）。
- Codex など他のエージェント。

## 確認

- 純粋モジュールの spec（項目の形、tmux の欄、優先順位、新しい方が勝つ）。
- 読み取りの spec（一時ホームに json を書き、死んだ pid と壊れたファイルは読まない、ホームが無ければ空）。
- ルートの spec（Claude のセルに `peerName`、Codex には `null`）。
- クライアントの spec（マージ、ロスターの行、チップのコピーと表示）。
- 実アプリ: 使い捨ての HOME でセルを開き、ヘッダーとロスターにアイコンが出て、押すとコピーされること。
