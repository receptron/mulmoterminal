# feat #435 — スマホからターミナル画面を閲覧する

Issue: #435。mulmoserver（Firebase PWA、スマホ）から mulmoterminal のターミナル画面を
**閲覧**する。Desktop と Mobile は物理的に分離しているため、既存の RemoteHost
（Firestore 経由のコマンドチャネル）に乗せる。初回スコープは閲覧のみで、入力・操作は含めない。

## 分割方針

1. **ホスト側: セッション一覧 + 画面取得ハンドラ**（この plan の対象・split 1）
2. mulmoserver 側: セッション選択 UI + 画面表示（split 2）
3. 通知契機での自動更新（split 3）

split 1 は mulmoterminal 単独で完結し、`capabilities` に載った時点で電話側から叩ける状態になる。

## Split 1 の設計（ホスト側）

`server/backends/remoteHost/handlers.ts` にハンドラを2つ追加する。ハンドラを足すだけで
`capabilities: Object.keys(handlers)` により電話側へ自動広告されるため、プロトコル変更は不要。

### `listTerminalSessions`

サーバ側に「ユーザが見ているセッションの一覧」は**存在しない**ので新規に組む。

- 既存 `GET /api/sessions`（`server/index.ts:1734`）は流用不可 — cwd スコープ、ディスクの
  `.jsonl` を読む方式、かつ grid セッションを明示的に除外（`:1766`）している
- フロントのグリッドもサーバから一覧を取っておらず、`localStorage` の `grid_v2` が持ち主。
  セッション id は WebSocket の `{type:"session"}` フレームで届く
- 素は `ptys`（`server/index.ts:572`）∪ `tmuxListSessionIds()`。`PtyEntry` は title も kind も
  持たないため、`knownSessions`（`:585`）/ `aiTitles`（`:540`）/ `activity`（`:495`）から join
- `isResumableTmuxSession`（`server/infra/tmux.ts:120`）でフィルタ。実測でこのマシンに `mt-`
  セッションが 66 個残っており、素直に列挙すると死んだセッションだらけになる
- 返す形は `{ sessions: [{ id, title, cwd, kind, tmux }] }` 程度。純粋な join 関数として切り出し、
  ハンドラ本体は薄く保つ（テスト容易性）

### `getTerminalScreen({ sessionId })`

セッションの種類で分岐する。分岐条件は `entry.tmux === true` の一点。

**tmux 経路** — tmux が入っていれば claude / launcher / codex は全てこちら。判定は tmux の
有無のみで env var による opt-out は無い（`server/index.ts:2119`）:

```
tmux -L mulmoterminal capture-pane -p -e -t mt-<sessionId>
```

- detach 中でも取得でき、サーバ再起動も跨ぐ（tmux が node プロセスより長生きするのが
  `tmux.ts` の主目的）
- `-e` で色を保持。命名 `mt-<sessionId>`、専用ソケット `-L mulmoterminal`
  （ユーザ自身の tmux とは隔離。`server/infra/tmux.ts:13-14,88`）
- 既存の `tmux()` ラッパ（`server/infra/tmux.ts:23`）に寄せる。**`execSync` の引数は 2 つ**
  （`execSync(cmd, options)`）で、配列を渡す形は存在しない

**非 tmux 経路** — `entry.buffer`（64KB リングバッファ、`server/index.ts:595`）を
`@xterm/headless` で描画:

```ts
const term = new Terminal({ cols: entry.term.cols, rows: entry.term.rows });
await new Promise<void>((r) => term.write(stripTerminalQueries(entry.buffer), r));
const buf = term.buffer.active;
const lines = Array.from({ length: buf.length }, (_, i) => buf.getLine(i)?.translateToString(true) ?? "");
term.dispose();
```

- `stripTerminalQueries`（`server/session/terminal-replay.ts`）と `translateToString` パターン
  （`src/composables/useTerminalConnections.ts:469`）はどちらも既存
- cols/rows は `entry.term.cols` / `.rows`（node-pty が公開、`resize` で更新される）。
  `PtyEntry` に新しい状態を足す必要は無い
- 追加依存は `@xterm/headless@6.0.0` のみ（現行 `@xterm/xterm@^6.0.0` とメジャー一致）
- Docker sandbox（`entry.sandbox`）もこちらで拾える

## 設計上の注意

- **`term.write()` は非同期**。コールバックを await せずに `buffer.active` を読むと空か途中が
  返る。素直に書くと踏む罠なので、ここはテストで固定する
- **64KB バッファはエスケープシーケンスの途中で切れうる**（#434）。非 tmux 経路はこの残骸を
  literal text として引き継ぐ。#434 を先に直せば本 issue 側は何もしなくてよいので、
  **#434 を先行させる**
- 「64KB の tail を空のエミュレータに流して画面を復元する」経路自体は reattach が既に
  production でやっている（`server/index.ts:1987`）ので、新規のリスクではない
- サーバ再起動でバッファが消える点は非 tmux では問題にならない。非 tmux の PTY は node
  プロセスの子なので、再起動でセッション自体が死ぬ（バッファの寿命 = セッションの寿命）
- **Firestore のコマンドドキュメントは 1MiB 上限**。collections が既にページングを強いられて
  いる（`handlers.ts:71-72`）。画面テキストにもサイズ上限を設ける。既定の取得行数は控えめに
- Run コマンドの一時 PTY（`server/index.ts:2366`）はバッファも id も持たない使い捨てなので
  対象外。一覧にも出さない

## テスト

- `listTerminalSessions` の join ロジック（純粋関数として切り出す）: title 欠落 / 非 resumable の
  除外 / 空一覧
- `getTerminalScreen` の分岐: tmux / 非 tmux / 存在しない sessionId
- 非 tmux 描画: `write` の await 漏れが起きていないこと（空文字が返らない）、cols/rows の反映
- tmux 経路は `tmux()` を stub して引数を検証（`-L mulmoterminal` と `-t mt-<id>` が付くこと）

## 前提

- #434（バッファ切り詰めの残骸）を先に対処する
