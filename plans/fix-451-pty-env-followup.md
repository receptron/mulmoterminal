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

あわせて PATH の判定を `name === "PATH"` の exact match から、`sanitizePtyEnv` と共有する
`isPathVar()` に置き換えて非対称を解消する（DRY）。

### 4. tmux の session environment が scrub されていない

グローバル環境しか scrub していないため、汚染されていた頃に作られた**既存セッション内で新規に
作られるペイン**は session-environment 経由で `PREFIX` を継承したままになる。

**方針**: scrub 処理を「対象を引数で取る」形に一般化し、グローバル → 各 `mt-` セッションの順に適用する。

留意点:
- 既存の**ペイン**には影響しない（プロセスは環境のコピーを既に持っている）。影響するのは
  そのセッションで**これから作られる**ペインだけで、それが本項の狙い。
- `show-environment -t <session>` はグローバルとセッションのマージ結果を返す。したがって
  グローバルを先に scrub してから回すこと。
- PATH は「サニタイズで実際に変化した時だけ」書き戻す。変化が無いのに `-t` で書くと、不要な
  セッションレベルの override を増やしてしまうため。

## 実装ステップ

1. `pty-env.ts`: `isLauncherPathEntry` を最終セグメント基準に書き換え、`isPathVar()` を追加してエクスポート
2. `pty-env.spec.ts`: 親ディレクトリ名の巻き込み / 末尾セパレータ / 相対エントリの回帰テストを追加
3. `tmux.ts`: `parseTmuxEnvironment()` を切り出してエクスポート、`scrubEnvironment(target)` に一般化、
   グローバル + 各セッションへ適用
4. `tmux.spec.ts`: `parseTmuxEnvironment` の単体テスト（通常 / `-NAME` / 複数行値 / 末尾改行）を追加
5. `yarn format` / `yarn lint` / `yarn build` / `yarn typecheck` / `yarn test`

## スコープ外

レビューで挙がった「`node_modules/.bin` 除去により claude/codex のローカルインストールが PATH 解決
できなくなる」件は、ランチャー汚染への依存を消すという #449 の意図どおりの挙動と判断し、扱わない
（必要なら `CLAUDE_BIN` / `CODEX_BIN` で明示指定できる）。
