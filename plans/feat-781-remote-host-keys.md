# feat(remote-host): スマホから生キーを送れるようにする (#781)

Claude は質問を**選択メニュー**で出すことが多い（`/model`、自前の選択肢、権限プロンプト）。
メニューは**キー押下**に答えるが、スマホからのライブ入力 `sendTerminalInput` は

1. `sanitizeTerminalInput` で制御バイトを全除去（＝矢印のエスケープ列は通らない）
2. bracketed paste で包む（＝貼り付けた数字はキー押下として届かない）

ので、出先でメニューが出ると作業が止まる。

サニタイズは**緩めない**。スマホから来る文字列は untrusted で、あれは `\e[201~` や Ctrl-C の
混入を防いでいる。代わりに**キー名の allow-list を取る別コマンド**を足す。バイト列を持つのは
ホスト側なので、信頼境界は今のまま（任意の制御バイトは PTY に届かない）。

バイト列そのものは実証済み: ブラウザのターミナルは `pty-connection.ts` で同じ
`term.write` に生キーを流していて、矢印も Esc もそこで動いている。

## 変更

### 1. `server/backends/remoteHost/terminalKeys.ts`（新規・純粋関数）

キー名 → バイト列のテーブルと、ワイヤ param の検証。PTY なしでテストできる。

| キー名 | バイト列 |
| --- | --- |
| `up` / `down` / `right` / `left` | `\e[A` / `\e[B` / `\e[C` / `\e[D` |
| `enter` | `\r` |
| `escape` | `\e` |
| `tab` / `shift-tab` | `\t` / `\e[Z` |
| `backspace` / `space` | `\x7f` / `` ` ` `` |
| `0`〜`9` | その文字 |

- **破壊的なキーは入れない**。Ctrl-C は turn 中なら turn を中断し、shell なら実行中プロセスを
  殺す。スマホの誤タップのコストが高すぎるので、必要になったら別途 issue で。
- **`enter` は `\r` 固定**で、`terminalSubmit`（#772）の submit binding を**通さない**。あれは
  Claude の**プロンプト入力欄**の binding で、メニューの確定は CR。打った行を確定するのは
  `sendTerminalInput` の仕事で、そちらは今も binding をセッション単位で解決する。
- 名前の照合は `hasOwnProperty`。`in` だとプロトタイプ鎖の `constructor` / `toString` が
  「既知のキー名」として通ってしまう。

### 2. `server/backends/remoteHost/sessionChain.ts`（`terminalInput.ts` から抽出）

「セッションごとに直列、セッション間は独立」という並行制御だけを持つ。抽出の理由は
**2 つの sender が同じチェーンを共有しないといけない**から: キー送信が
`[paste]` と 150ms 後の `[CR]` の**間に**割り込むと、矢印が下書き中のカーソル移動として
効いてしまう。

### 3. `server/backends/remoteHost/terminalInput.ts`

`createTerminalInputSender` → `createTerminalSender` に改名し、`{ sendText, sendKeys }` を返す。
チェーンは 1 つ。テキスト経路（sanitize → clear+paste → 遅延 Enter）は**変更なし**。

`sendKeys` は sanitize / paste / Ctrl-C クリア / 末尾 submit を**一切通さない**:

- **1 キー 1 write**、キーの間だけ間隔を空ける。理由は paste の Enter を遅らせるのと同じで、
  ハイライト移動で再描画中の TUI は同じ tick に来たキーを落とし得る。
  （tmux 側は `escape-time 0`（`server/infra/tmux.ts`）なので、単独の `escape` は
  シーケンス待ちで溜められず即転送される。）
- 途中の write が失敗したら**そこで throw**。テキスト経路の Enter は「paste はもう見えている」
  ので best-effort だが、キー列は何個目まで届いたかがスマホから見えないので黙って諦めない。
- 1 コマンドあたり最大 16 キー。セッションのチェーンを 1 コマンドが長時間占有しないため。

### 4. `server/backends/remoteHost/handlers.ts`

`sendTerminalKeys({ sessionId, keys: string[] })` を追加。deps は増えない（`writeToSession` は
既にある）ので `server/index.ts` と `remoteHost/index.ts` は無変更。capability は
`buildHostPresence` が handler のキーから導出するので**プロトコル変更なし**。

## テスト

- `terminalKeys.spec.ts`: 各キーのバイト列、未知の名前 / 非配列 / 空配列 / 上限超え、
  プロトタイプ鎖（`constructor` / `__proto__` / `toString`）、`enter` が `\r` であること
  （#772 の binding を通さない意図の固定）。
- `sessionChain.spec.ts`: 同一セッションは直列、別セッションは並行、reject 後もチェーンが
  生きている、最後の 1 つが消える（溜まらない）。
- `terminalInput.spec.ts`: 既存はそのまま（改名のみ）＋ `sendKeys` の write 内容 / 間隔 /
  paste 経路と混ざらない / clear も submit も付かない / PTY 無しの報告。
- `handlers.spec.ts`: handler 一覧に追加、キー列が `writeToSession` まで届く、
  `sessionId` 欠落と不正なキーの拒否。

## スマホ側（別 PR: receptron/mulmoserver）

キー行（↑↓←→ / Enter / Esc / Tab）と、既にある番号チップ（`useTerminalChips.ts` — 今は
入力欄に数字を入れるだけ）を「数字キーを押す」に変える。capability に `sendTerminalKeys` が
無いホスト（旧版）では従来どおり入力欄に入れる。
