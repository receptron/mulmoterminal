# fix: セッションのドロップ置き場を Claude Code の trust 済みにして、追加ディレクトリの確認を出さない

Issue: #3313

## User Prompt

- 最新の MulmoTerminal を使っていると、時々「Adding a new directory: …/mulmoterminal-drops/<id> … Is this a directory you created or one you trust?」という警告が出る。何か？
- 出ないようにできる？
- その方針（ドロップ置き場の親を Claude Code の設定ファイルで信頼済みにする）で進めて

## 背景

claude セルは起動のたびに `$TMPDIR/mulmoterminal-drops<suffix>/<session id>` を作り、`--add-dir` で渡している
（ドロップ・貼り付けたファイルを許可プロンプトなしで読ませるため）。Claude Code 2.1.326 から、`--add-dir` で
渡したディレクトリが trust 済みでないと起動時に全画面で確認するようになった。

2.1.326 のバイナリを読んだ判定:

- trust は設定ファイルの `projects[<path>].hasTrustDialogAccepted === true`。
- パスは実パス（macOS なら `/private/var/folders/...`）で引く。
- git リポジトリの外なら、そのディレクトリから `/` までの**祖先**を順に見て、どれかが trust 済みなら通す。

## 方針

ドロップ置き場の**親**（`DROPS_ROOT`）を、そのセルが使うログインの設定ファイルで trust 済みにする。キーは「親の上の一時ディレクトリの実パス + 親の名前」（親そのものはたどらない。親がリンクにすり替えられても、リンク先を trust しないため）。
セッションごとのディレクトリは祖先探索で全部それに入る。

- #3206（利用状況プローブのフォルダ）と同じ理屈・同じ書き込み手順。親は MulmoTerminal が作る 0700 の
  ディレクトリで、中身は自分たちが書いたファイルだけなので、trust しても Claude Code が新たに読めるものはない。
- 設定ファイルの選び方もプローブと同じ: セルがアカウントに束ねられていればその `CLAUDE_CONFIG_DIR`、
  それ以外は既定（サーバーの `CLAUDE_CONFIG_DIR`、なければ `~/.claude.json`）。
- 書く条件: `ensureDropsDir` が成功したとき（= 親が自分たちの非リンクのディレクトリだと確認できたとき）だけ。
- 読んで trust 済みと分かった設定ファイルは、そのファイルの dev・inode・サイズ・mtime と一緒に覚え、変わるまで
  読み直さない（1MB 近いファイルを毎回読まない。保存でエントリが消えたら次の起動で書き戻す）。
  書いただけでは覚えない（Claude Code の保存に上書きされ得るので、次の起動で読み直す）。
- 書けないとき（設定ファイルが無い・読めない・JSON でない）は何もしない。起動は続き、確認が出るだけ（今と同じ）。

見送り: `CLAUDE_CODE_SANDBOXED`（この判定以外も大きく変わる）、`--add-dir` をやめる（ドロップの度に許可を聞く状態に戻る）。

## 変更

- `server/agents/probe/probe-trust.ts` → `server/agents/claude/own-folder-trust.ts` に移し、関数名から probe を外す
  （`withFolderTrusted` / `ensureFolderTrusted` / `isFolderItself`）。挙動は変えない。呼び手が二つになるため。
- `server/session/drops-trust.ts`（新規）: `dropsRootTrustKey()` と `markDropsRootTrusted(sessionId)`。
- `server/session/spawn/agents/spawn-claude.ts`: `sessionAddDirs` で、ドロップ置き場ができたらセルの設定ファイルに親の trust を書く。
- `server/agents/rate-limit/rate-limit-service.ts`: 新しい名前で呼ぶだけ。

## 範囲外

- サンドボックス（コンテナ）で動くセル: 設定ファイルはコンテナ側のもの。今回は触らない。
- codex など他エージェント: ドロップ置き場の確認を出さないので対象外。

## 検証

- `yarn format` / `lint` / `typecheck` / `test`。
- spec: アカウントに束ねたセルと既定のセルで、それぞれの設定ファイルに親のキーで書くこと、親がリンクに
  すり替わってもリンク先を名指ししないこと、trust 済みの設定ファイルは変わるまで読まず、変われば読み直すこと。
- 実機: 使い捨て HOME のサーバーで新しい claude セル（2.1.326）を開き、確認が出ないこと、設定ファイルに
  親の実パスのエントリができることを確かめる。
