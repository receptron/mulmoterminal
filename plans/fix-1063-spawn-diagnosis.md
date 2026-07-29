# fix #1063 — 起動失敗の原因を、推測ではなく実測で報告する

## 症状

codex セッションを開こうとすると次が出る。

```
[Failed to start codex. Is the `codex` CLI installed and on your PATH?]
```

ただし報告者の Mac では素のターミナルから `codex` は動く。

## 調査でわかったこと

メッセージは `server/routes/ws-routes.ts` の catch が **例外を捨てて決め打ちで書いた文言**で、
実際の原因は書かれていない。実測（macOS / node-pty 1.1.0）:

| codex の状態 | tmux なし | tmux あり | ブラウザ表示 |
|---|---|---|---|
| 不在 | exit=1 出力なし | ペイン内 `command not found` → 即終了 | `[session ended]` |
| 実行権限なし / 壊れた symlink / 不正な shebang / 同名ディレクトリ / ENOEXEC | exit=1 か 127 | 同上 | `[session ended]` |
| `CODEX_BIN` が実在しない絶対パス | exit=1 | — | `[session ended]` |

**macOS では codex 側のどんな状態も同期例外にならない。** 構造的な理由:

- `resolvePtyLaunch` は Windows 以外では `{ file: bin, args }` を素通しする
- `pty.fork` が `posix_spawnp` するのは `spawn-helper` であって codex ではない
- codex の PATH 解決と exec は helper 側の `execvp` が行い、失敗は `_exit(1)` になる

`pty.spawn` が macOS で throw するのは pty 割り当ての失敗だけで、これは
`pty.cc` が `err` を `-1` 初期化したまま早期 return する作りのため、
posix_openpt / grantpt / TIOCPTYGNAME / slave の open / tcsetattr のいずれが失敗しても
`posix_spawnp failed.` になる。pty を枯渇させて再現済み（242 pty で発生、
`kern.tty.ptmx_max` はシステム全体で 511）。

Windows は逆に node-pty 自身が PATH を解決して `File not found:` を同期 throw する（#794）。
今の文言はそちら向けに書かれたものが、全プラットフォームに適用されている。

さらに tmux 経路では、ペインに出た `command not found` が
**alt screen の復帰で消える**ため、一番ありがちな原因が一番読めない表示になっている。

## 直すこと

### 1. spawn 前に、実際に使う環境で診断する

`server/infra/has-binary.ts` に純粋関数を足す。

```ts
export type BinaryDiagnosis =
  | { kind: "ok"; path: string }
  | { kind: "missing"; searched: readonly string[] }
  | { kind: "not-executable"; path: string };

export function diagnoseBinary(bin, env, platform, probe): BinaryDiagnosis
export function binaryProblemMessage(bin: string, d: BinaryDiagnosis): string | null
```

- 探索順は execvp と同じ「PATH 先頭から、最初に見つかった**実行可能なファイル**」。
  実行可能でないものしか無ければ `not-executable`、ファイルが一つも無ければ `missing`。
- **この判定は spawn を拒否するので、execvp より厳しくしてはいけない。**
  PATH の**絶対でないエントリ**は execvp が子プロセスの cwd（= PTY の cwd）に対して
  解決するので、こちらからは答えられない。空エントリ（`/usr/bin:`、`/a::/b`、`PATH=""`）は
  POSIX でカレントディレクトリを指す綴りで、`tools` や `.` や `../bin` はそれを
  そのまま書いたもの。PATH 未設定も execvp は自前の既定パス（confstr `_CS_PATH`）を使う。
  いずれも `ok` を返して spawn させる。実測で確認済み（末尾 `:` / `PATH=""` / `PATH=tools`
  のいずれでも PTY の cwd 側の実行ファイルが起動する）。Codex と CodeRabbit のレビュー指摘。
- `hasBinary` はこれを使って書き直す（判定とspawnが違う答えを出さないため。
  副作用として、存在するが実行できない claude は「使えない」と正しく答えるようになる）。

**渡す env は `process.env` ではなく、PTY が実際に受け取るサニタイズ済み env。**
`sanitizePtyEnv` は `node_modules/.bin` / `yarn--*` / `node-gyp-bin` を PATH から落とすので、
`process.env` で判定すると「入っている」と言いながら spawn は見つけられない食い違いが起きる。
そのために `pty-spawn.ts` の env 構築を `ptyEnv()` として切り出し、spawn と診断が同じものを見る。

### 2. reattach では診断しない

`tmux new-session -A` は生きているセッションに **attach するだけで `file` を実行しない**。
バイナリが後から消えても reattach は成功すべきなので、
`ptyWouldReattach(sessionId, persistent)` が真なら診断をスキップする。
チェックは `ptySpawn` に置く（reattach かどうかを知っている唯一の場所）。

### 3. 例外を捨てない

4 か所の catch すべてで実エラーを本文に載せる。
claude の `ProviderRefusedError` 特別扱いは維持する。

### 4. exit コードを画面に出す

shebang 不正・アーキテクチャ違いなど、**事前診断では捕まえられない**残りのケースは
「exit したこと」しか手がかりが無い。`messageEffect` の exit バナーに、
0 以外のとき exit コードを載せて赤にする。

これが効くのは tmux が無いホストと `/ws/run` のコマンドセルまで。
**tmux 経由ではペインのプログラムが失敗しても `tmux new-session` 自体は 0 で終わる**ため、
exit コードは 0 のまま届く（実測）。tmux 経路で残るのは 1 の事前診断が拾えないケースだけなので、
本 PR ではそこまでとする。

## やらないこと（検討した上で）

- `tmuxAvailable()` は `process.env` で tmux を探し、spawn はサニタイズ後 PATH を使う、という
  同種の食い違いがある。ただし tmux が `node_modules/.bin` にあるのは現実的でないため、
  `spawnCapture` の API を変えてまで直す価値は今は無いと判断した。
- pty 枯渇そのものの対策（セッション上限、リーク調査）は別件。
  本 PR は「枯渇したときにそう読める」ところまで。

## テスト

- `test/server/infra/has-binary.spec.ts`（新規）— missing / not-executable / ok、
  実行可能でない候補が先にあっても後ろの実行可能なものを選ぶこと、Windows の `.exe` / `.cmd`、
  パス形式の名前。probe を注入するので POSIX ホストから Windows 規則も検証できる。
- `test/src/composables/serverMessage.spec.ts` — exit コード付きバナー。
- 既存の `resolve-bin.spec.ts` / `pty-env.spec.ts` は無変更で通ること。

## 実サーバでの確認結果

| 条件 | 結果 |
|---|---|
| `CODEX_BIN=codex-does-not-exist-xyz` | 探した PATH 付きで「not on the PATH this server spawns with」。サーバログに PATH 全体 |
| `CODEX_BIN=<644 のファイル>` | 「is not an executable file」 |
| **生きている tmux セッションへの reattach（CODEX_BIN は壊したまま）** | **従来どおり attach 成功。診断は走らない** |
| `CODEX_BIN=<shebang 不正>`・tmux 無し | 事前診断は通過（実行可能ファイルではある）し、`exit=1` が届く |
