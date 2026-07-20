# fix: #449 のフォローアップ — PATH 判定のアンカー漏れと tmux 環境 scrub の取りこぼし

Issue: #451 / 元 PR: #449

## 背景

#449 で「パッケージマネージャのランチャー環境変数が PTY に漏れて nvm を壊す」問題を修正した。
根本原因（`PREFIX` → nvm が PATH から bin を剥がした *後* に互換性チェックで中断する）と、
汚染源が 2 箇所ある（node 側 `process.env` / node より長生きする tmux サーバのグローバル環境）
という構造は正しく押さえられている。本 PR はその上に残った 4 点の粗さを潰す。

## 対応する 4 点

### 1. yarn の PATH 判定だけアンカーされていない

`isLauncherPathEntry` の 3 つの判定のうち yarn だけが終端アンカーを持たず、パス中のどこにでも
マッチする。`/Users/x/yarn--2-experiments/bin` のような**親ディレクトリ名**で配下ごと落ちる。

**方針**: 3 つとも「PATH エントリの最終セグメント」基準に統一する。これで報告された
「祖先ディレクトリ名で配下ごと落ちる」ケースは消える。yarn 側の判定は `^yarn--\d` のまま
（最終セグメント基準になった時点で十分に狭く、yarn 内部の命名規則へ余計な仮定を置かずに済む）。

副次的な改善として、相対エントリ（`node_modules/.bin`、先頭にセパレータが無い）も判定できるようになる。
現行は `/[\\/]node_modules[\\/]\.bin$/` が先行セパレータを要求するため取りこぼしていた。

### 2. Windows の末尾セパレータ

`C:\repo\node_modules\.bin\` が `$` アンカーに引っかからず残る。最終セグメントを取り出す前に
末尾セパレータを落として吸収する（1 の実装に自然に含まれる）。

### 3. `scrubGlobalEnvironment` の行ベース parse

`show-environment` の値に改行が含まれると（bash のエクスポート関数 `BASH_FUNC_x%%=() {\n...`）
継続行を変数名として誤読する。実害が出るのは継続行が `PATH=` で始まった時だけで極小だが、
parse を独立した純粋関数に切り出して直しておく。

**方針**: `parseTmuxEnvironment()` を `tmux.ts` に純粋関数としてエクスポート（`isResumableTmuxSession`
と同じく「純粋だからテストできる」の前例に倣う）。行が新しいエントリを始めるのは
`NAME=` / `-NAME` の形をしている時だけとし、それ以外は直前の値の継続行として連結する。

### 4. tmux の session environment scrub → **実測により不要と判明。取り下げ**

当初は「汚染されていた頃に作られた既存セッションが自前のコピーを持つので、session-environment も
scrub すべき」と考えていた。tmux 3.6a で実測したところ、この前提が誤っていた。

使い捨てソケット（`-L mulmoterminal` には触れずに検証、後で kill-server 済み）:

| 検証 | 結果 |
|---|---|
| グローバル env の非 PATH 変数 → 新規ペイン | 届く。`set-environment -g -r` での削除も効く |
| グローバル env の `PATH` → 新規ペイン | **届かない**。global `/GLOBAL/only` + client `/CLIENT/only` で、ペインは `/CLIENT/only` を取得 |
| 既存セッション内の新規ウィンドウ | 同上（client の PATH が勝つ） |
| セッション env への launcher 変数のコピー | **存在しない**。`update-environment`（DISPLAY / SSH_* 等）の分だけ |

稼働中の `mulmoterminal` サーバの実セッションを読み取り確認しても、session env には
`update-environment` 由来の変数しか入っていなかった。

したがって:

- **session environment を scrub する必要はない**。launcher 変数がそこに入る経路が存在しない。
  手動 split されたペインも、親ペイン（= サニタイズ済み）の環境を継承する。
- 副産物として、#449 の **`set-environment -g PATH <sanitized>` が no-op** であることも判明した。
  tmux は自分の env の PATH を新規ペインに適用しない。PATH が実際に直っているのは client 側、
  つまり `spawnPty` に渡している `sanitizePtyEnv` の効果である。

**方針**: session env scrub は実装しない。あわせて no-op である global PATH の書き戻しを削除し、
「なぜここで PATH を触らないのか」を実測値つきでコメントに残す。効果のない書き込みが残っていると
「PATH はここで面倒を見ている」と次の読者に誤読させるため。

これに伴い項目 3 の「`isPathVar()` で PATH 判定を共有する」も tmux 側では不要になる
（`isPathVar()` は `sanitizePtyEnv` 内の重複を消すために残す）。

## 実装ステップ

1. `pty-env.ts`: `isLauncherPathEntry` を最終セグメント基準に書き換え、`isPathVar()` を追加してエクスポート
2. `pty-env.spec.ts`: 親ディレクトリ名の巻き込み / 末尾セパレータ / 相対エントリの回帰テストを追加
3. `tmux.ts`: `parseTmuxEnvironment()` を切り出してエクスポートし、`scrubGlobalEnvironment()` は
   launcher 変数の `-r` 削除だけを行う（PATH の書き戻しを削除）
4. `tmux.spec.ts`: `parseTmuxEnvironment` の単体テスト（通常 / `-NAME` / 複数行値 / 末尾改行 / 空）を追加
5. `yarn format` / `yarn lint` / `yarn build` / `yarn typecheck` / `yarn test`

## スコープ外

レビューで挙がった「`node_modules/.bin` 除去により claude/codex のローカルインストールが PATH 解決
できなくなる」件は、ランチャー汚染への依存を消すという #449 の意図どおりの挙動と判断し、扱わない
（必要なら `CLAUDE_BIN` / `CODEX_BIN` で明示指定できる）。
