# MulmoTerminal

[English](README.md) · **日本語** · [简体中文](README.zh.md)

**コーディングエージェントのセッションを並列で走らせ、どれが自分を待っているかを見る。**

**並列 AI コーディングエージェントのためのブラウザ端末**です。複数のセッションが
一つずつセルに入って並び、**あなたを待っているものだけが色で示されます**。
既定は **Claude Code** で、ほかに6つの CLI を同格で扱えます —
Codex、Antigravity、Grok、Muse、GitHub Copilot CLI、Cursor CLI。
エージェント1体の vibe coding にシェル以外は要りません。これは**複数走らせて、どれが待っているか
分からなくなったとき**のための道具です。セッションはリロードを越えて残り（tmux）、作業は
**git worktree** で隔離され、ターンが終わると**スマホに通知**が飛びます。

**すべてのセルが本物の pty です。** `htop`、`lazygit`、開発サーバー、Claude Code —
ここでは同じ種類のものです。だから「worktree あたり1セッション」の制限は**エージェントにだけ**
掛かり、シェルや `yarn dev` はエージェントが作業している worktree に同居できます。

## デモ

![MulmoTerminal — 状態ごとに色分けされた Claude Code セッションのグリッドがリアルタイムに更新される様子](https://raw.githubusercontent.com/receptron/mulmoterminal/main/docs/guide/images/hero.gif)

*グリッドの実機。各セルが **作業中** / **完了** / **あなた待ち** で色分けされます。*

```bash
npx mulmoterminal@latest        # http://localhost:34567 で起動し、ブラウザが開きます
```

**Node 22.12 以上**と、`PATH` に通ってログイン済みの
[`claude`](https://claude.com/claude-code) CLI が必要です。
`npx mulmoterminal@latest init` が、足りないものを教えてくれます。

### tmux + iTerm のペインで十分では？

並列に走らせること自体は難しくありません。tmux で十分です。失われるのは
**5つのうちどれが自分を待っているか**です。ペインは不透明で、作業中・完了・権限確認待ちの3つが、
読むまで見分けられません。

MulmoTerminal では、すべてのセルが自分の状態を一つのグリッドに報告します —
作業中（青）、完了（緑）、**あなた待ち**（琥珀）。画面外のセルが琥珀になれば音が鳴ります。
さらに**1セッション1行の cockpit roster** があるので、1つに答えている間も残り4つを見失いません。

tmux が入っていればその**上で**動き、[再起動を越えて残ります](#セッションの永続化-tmux)。

## なぜ欲しくなるか

- **全エージェントを一度に見る。** 状態で色分けされたセルのグリッド — 作業中（青）、
  **権限待ち / あなた待ち**（琥珀）、**完了・未確認**（青）、待機。注意音とツールバーの件数表示が
  付くので、画面外で詰まったエージェントを見落としません。1つの端末に張り付くのをやめて、
  10体を監督する側に回れます。1つを拡大しても **cockpit roster** が残りを視界に保ちます —
  1セッション1行で、AI 要約・直近のプロンプト・最新の返答・ブランチの **PR 状態**
  （draft / CI 失敗 / ready / merged）が並びます。
- **端末だけでなく、エージェントのための GUI。** 端末の横の **Canvas** パネルが、
  エージェントが MCP 経由で出したもの — **文書・フォーム・グラフ・生成画像・HTML・
  コレクションカード** — をそれぞれ専用プラグインで描画します。
  エージェントはテキストを流すのではなく、インターフェースを手渡してきます。
- **どこにいても呼び戻される。** 完了時・入力待ち時に**スマホへ Web Push** が飛び、
  **RemoteHost** を使えばスマホから状況を見て、タップで（**yes / no / continue**）
  答えられます。席を立ち、呼ばれ、戻る。
- **再起動で何も失わない。** `tmux` があれば、サーバーのクラッシュ・再起動・`node --watch` の
  リロードを越えて全セッションが生き残ります。ターン途中のエージェント、長いビルド、
  開発サーバーがそのまま走り続け、戻ると再接続されます。
- **グリッドから出ずに出荷する。** 各リポジトリのセルに **git ブランチのチップ**が出て、
  ワンクリックで **git worktree** に隔離し、**diff** パネルを開き、
  **commit / push / PR 作成**まで行えます。複数のエージェントが同じリポジトリを、
  衝突せずに触れます。
- **いくら掛かっているか分かる。** セッションごとの**コンテキスト %**・**トークン**・
  **推定 $**、ツール呼び出しの**タイムライン**、セル名とコマンド出力の **AI 要約** —
  並列エージェントの壁が、読めるものに保たれます。
- **自分のものにする。** ディレクトリごとの**テーマ・色・名前バッジ**（`prod` は赤、
  `staging` は琥珀）、設定可能なヘッダー、独自の注意音、そしてプロジェクトのスクリプト・
  `.claude/skills`・デッキをセル内から起動する Run / Skill / Mulmo メニュー。

![MulmoTerminal のグリッド — 4つの Claude セッションが、それぞれ色分けされたプロジェクトで並列に動いている](https://raw.githubusercontent.com/receptron/mulmoterminal/main/docs/guide/images/grid-2x2-live.png)

*グリッドは**並列エージェントの管制塔**です。各セルのヘッダーに、切り分けに必要なものが並びます —
**モデル・コンテキスト %**、**トークン数**（`⇡in ⇣out`）、**git ブランチ / 変更**のチップ、
そしてエージェントが何をしているかの AI 要約。**セルの枠の色が状態を示し**、画面外で詰まったセルは
音で呼び戻します。多数を監督し、呼ばれたところにだけ入る。*

### 中身の仕組み

各セッションはサーバー上で本物の PTY として動き（エージェント CLI を疑似端末に入れています）、
WebSocket 経由でブラウザの [xterm.js](https://xtermjs.org/) 端末に流れます。

**cockpit roster** は全セッションを一覧し、**作業中**（考えている）・**あなた待ち**
（権限確認や質問 — 琥珀の点。答えるまで何も進みません）・**完了していて未確認**（緑の点）を
リアルタイムに反映します。これは**サーバーが起動時に注入する Claude / Codex の activity hook**
から取っており、画面の文字を解析しているのではありません。

> ここが要点です。端末の中では「権限確認で止まっている」と「まだ考えている」が**同じに見えます** —
> どちらも出力が止まるだけだからです。画面を読んでも区別できませんが、hook なら区別できます。
>
> （Codex は「入力待ち」を報告しません。確認ダイアログが自身の TUI に描かれ、rollout ファイルに
> 届かないためです。したがって Codex は「作業中 / 完了」の2状態になります。）

## 使ってみた人が言うこと

> IDE や分割端末から移ってきた人の報告であって、ベンチマークでも、こちらが測定した主張でも
> ありません。環境によって違うはずです。

**「メモリを食わなくなった」** — エージェントを分けるために IDE のウィンドウを複数開くのは
高くつきます。それぞれがエディタ・言語サーバー・拡張・ファイル監視を連れてくるためです。
**64GB のマシンがその負荷で引っかかっていた**人が、移行後は滑らかに動いたと報告しています。
ここではエージェントはサーバー上の PTY で、UI はブラウザのタブです。

**「別のエージェントに返事をしなくなった」** — スクロールするテキストのペインが6つ並ぶと、
どれも同じに見えます。**別のエージェントの端末に返事を打ち込んでいた**、最初に何を頼んだか
分からなくなった、という報告があります。問題は注意力ではなく、**同じペインが N 個あると
N 個の文脈を頭に保持しなければならない**ことです。状態の色分け・名前バッジ・
ディレクトリごとの色が、それを頭から画面に移します。

**「多数を見ることと1つを読むことが、二者択一でなくなった」** — 端末を6分割すると、
どのペインも長い返答を読むには小さすぎます（4,000文字の返答でまさにそうなった、という報告）。
エージェントを増やすたびに、読みやすさを静かに諦めることになります。
**グリッド ↔ 拡大**がそれを解消します。全部を見て、1つを拡大してきちんと読む。
その間も cockpit roster が残りをテキストで視界に保ちます。

**「今までのセッションがそのまま来た」** — セッションはそのまま再開します（同じ
`claude --resume`、同じ履歴）。既に作業しているディレクトリを指定すれば、履歴はそこにあります。
移行も、やり直しも要りません。

**10体いなくても元は取れます。** 並列 **1〜3** セッションの時点で移行する価値があったという
報告があります。上に挙げた利点は「もっと多く走らせること」ではなく「見失わないこと」の話です。

## インストールと起動

**Node 22.12 以上**と、`PATH` 上の以下の CLI が必要です。

> **どれも入れたことがない場合**は、コマンドラインの経験がない前提で、macOS と Windows の
> 両方を最初から説明したガイドがあります:
> [はじめに — 起動するまで](https://receptron.github.io/mulmoterminal/guide/ja/getting-started.html)

| | ツール | 何ができるようになるか | インストール |
| --- | --- | --- | --- |
| **必須** | [`claude`](https://claude.com/claude-code) | すべての Claude セッション。本アプリはその管制塔です | `npm i -g @anthropic-ai/claude-code` のあと、一度 `claude` を実行してログイン |
| **必須** | `git` | worktree による隔離、各セルのブランチ / 未保存ドット / diff 表示、PR フッター | `brew install git` · `sudo apt install git` · Windows: [git-scm.com](https://git-scm.com/download/win) |
| **必須** | `gh` | 横断的な **PR & Issue** ビューとワンクリック PR 作成。`gh` のログインを使うのでトークンは保存しません | [cli.github.com](https://cli.github.com) のあと `gh auth login` |
| 任意 | `glab` | **GitLab** プロジェクトで同じこと。self-hosted も設定可 | `brew install glab` のあと `glab auth login` |
| 推奨 | `tmux` | **セッションの永続化** — サーバー再起動を越えて端末が残ります | `brew install tmux` · `sudo apt install tmux` · Windows ネイティブ版は無し（通常の PTY にフォールバック） |
| 任意 | `codex` | セル内での **Codex セッション** | `npm i -g @openai/codex` |
| 任意 | `ffmpeg` | mulmo-script パネルからの動画生成 | `brew install ffmpeg` · `sudo apt install ffmpeg` |
| 任意 | `ollama` | 完全にローカルなモデルで Claude Code を動かす | [ollama.com/download](https://ollama.com/download) |

必須でない行が無くてもサーバーは起動します。その機能が使えなくなるだけで、
ヘッダーやパネルがその旨を表示します。

```bash
npx mulmoterminal@latest           # http://localhost:34567 で起動しブラウザを開く
# またはグローバルに入れる:
npm install -g mulmoterminal
mulmoterminal
```

**止め方。** 起動した端末で `Ctrl+C`。その端末が見つからなければ、ブラウザの
**Settings → Quit MulmoTerminal**、または任意の端末から **`npx mulmoterminal@latest stop`**。
`tmux` が入っていればエージェントのセッションは生き残り、**Settings → Sessions that survived
a restart** から戻ってきます。

**初回セットアップ（任意）。** `npx mulmoterminal@latest init` が環境を確認し、
Claude Code の履歴からランチャーの**ディレクトリ候補**を作り、`~/.mulmoterminal/config.json`
を書きます。**何度実行しても同じ結果**になるので、候補を更新したくなったらいつでも再実行できます。

## ドキュメント

**[receptron.github.io/mulmoterminal](https://receptron.github.io/mulmoterminal/)**

- **ユーザーガイド:** [日本語](https://receptron.github.io/mulmoterminal/guide/ja/) —
  グリッドの使い方・日々のワークフロー・機能一覧・設定・スマホ通知
- **User guide:** [English](https://receptron.github.io/mulmoterminal/guide/en/)
- **アップデート情報:** 新バージョンや新機能は X でお知らせしています —
  日本語は [Singularity Society (@SingularitySoci)](https://x.com/SingularitySoci)、
  英語は [@mulmocast](https://x.com/mulmocast)

## 作っている人

**[receptron](https://github.com/receptron)** —
Microsoft で **Windows 95** のソフトウェアアーキテクトを務めた
**[中島聡](https://x.com/snakajima)** と **[有本勇](https://github.com/isamu)**。
**[GraphAI](https://github.com/receptron/graphai)** と同じ2人です。

## ライセンス

MIT

---

> **この README は、英語版の最初の約360行（製品の説明と導入）に対応しています。**
> 設定・アーキテクチャ・スクリプト・スキル・デッキ・worktree と PR・リモートホストなどの
> 詳細は、[英語版 README](README.md) と
> [日本語ユーザーガイド](https://receptron.github.io/mulmoterminal/guide/ja/) を参照してください。
