---
title: はじめに — 起動するまで
layout: default
parent: 日本語
nav_order: 1
description: MulmoTerminal を起動するまでの手順を 1 ページにまとめました。ターミナルの開き方、Node.js・Claude Code・git / gh の入れ方（macOS / Windows）、起動コマンド、つまずいたときの対処まで。エンジニアでない方でも、ここだけ読めば起動までたどり着けます。
---

# はじめに — 起動するまで
{: .no_toc }

**このページだけで、何も入っていない状態から MulmoTerminal が動くところまで行きます。**
プログラミングが専門でない方も想定しています。上から順に進めれば大丈夫です。

<details open markdown="block">
  <summary>目次</summary>
  {: .text-delta }
- TOC
{:toc}
</details>

---

## いますぐ起動する

**Node.js 22.12 以上**と **`claude` コマンド**がすでに入っている方は、これだけです。

```bash
npx mulmoterminal@latest
```

ブラウザが開いて `http://localhost:34567` が表示されれば成功です。止めるときは、
コマンドを打ったターミナルで **Ctrl + C**。そのターミナルが見つからなくなったら、
別のターミナルで `npx mulmoterminal@latest stop` を実行してください。

- 動いた → [起動できたら、最初にやること](#first-run)
- 何か言われて止まった → [うまくいかないとき](#troubleshooting)
- そもそも上の 2 つが入っているか分からない → このまま下へ

{: .note }
> **インストールは不要です。** `npx` は「その場でダウンロードして実行する」コマンドなので、
> MulmoTerminal 自体をインストールする作業はありません。合わなければ閉じるだけで終わりです。

---

## 出てくる言葉（先にここだけ）

| 名前 | 何者か | なぜ要るか |
|---|---|---|
| **ターミナル** | 文字でコンピュータに命令する画面。mac の「ターミナル」、Windows の「PowerShell」 | ここに 1 行貼り付けるところから始まります |
| **Node.js** | JavaScript を動かすための土台。`npm` / `npx` というコマンドが付いてきます | MulmoTerminal 本体がこの上で動きます |
| **Claude Code** | Anthropic の AI コーディングエージェント。ターミナルで動く `claude` コマンド | **MulmoTerminal が並べて動かしている中身がこれ**です |
| **git** | ファイルの変更履歴を管理する道具 | 作業の隔離（worktree）、ブランチ表示、差分・コミットに使います |
| **GitHub** / **`gh`** | git のプロジェクト置き場（Web サービス）と、その公式コマンド | PR / Issue の一覧表示、ワンクリック PR 作成に使います |

**MulmoTerminal 自体は AI ではありません。** あなたの `claude` を何体も動かして、
「いまどれが自分の返事を待っているか」を見えるようにする**操縦席**です。

入れていく順番と、無いとどうなるかは次のとおりです。

| | 無いとどうなるか | 手順 |
|---|---|---|
| **Node.js 22.12+** | 起動できません | [ステップ 1](#step1) |
| **Claude Code** | 起動できません（唯一の必須チェック） | [ステップ 2](#step2) |
| git / gh | 起動はします。worktree・差分・PR 機能が消えます | [ステップ 3](#step3) |
| tmux | 起動はします。サーバ再起動でセッションが消えます | [ステップ 3](#step3) |

---

## ステップ 0 — ターミナルを開く {#step0}

**macOS** — `Command + Space` を押して `ターミナル` と打ち、Enter。

**Windows** — スタートボタンを押して `PowerShell` と打ち、Enter。
（Microsoft Store の [Windows Terminal](https://aka.ms/terminal) でも構いません）

以降、コード枠に書いてあるものは**この画面に貼り付けて Enter** してください。
ターミナル自体がはじめてなら、Claude Code 公式の
[ターミナル入門](https://code.claude.com/docs/ja/terminal-guide)が丁寧です。

{: .note }
> **黒い画面にコマンドを貼るのが怖い方へ。** このページに書いてあるコマンドは、
> 公式サイトが配っているものをそのまま使っています。貼り付ける前に、
> 各ステップに載せた**公式サイトのリンク**で同じコマンドが書かれているか見比べてください。
> 出どころの分からないコマンドを貼らない、という習慣そのものは正しいです。

---

## ステップ 1 — Node.js を入れる {#step1}

**何のため:** MulmoTerminal 本体が動く土台です。あわせて `npx` コマンドが入ります。
**必要なバージョン:** **22.12 以上**（公式の LTS 版を入れれば満たします）。

### まず確認

```bash
node -v
```

`v22.12.0` 以上の数字が出れば、このステップは飛ばしてください。
`command not found` と出るか、数字が小さければ下へ。

### macOS

[nodejs.org/ja/download](https://nodejs.org/ja/download) を開き、**LTS** の
**macOS Installer (.pkg)** をダウンロードして実行します。画面の指示に従うだけです。

Homebrew を使っている方は `brew install node` でも構いません
（Homebrew 自体は [brew.sh/ja](https://brew.sh/ja/)）。

### Windows

[nodejs.org/ja/download](https://nodejs.org/ja/download) から **LTS** の
**Windows Installer (.msi)** をダウンロードして実行します。

コマンドで入れる場合は PowerShell で：

```powershell
winget install -e --id OpenJS.NodeJS.LTS
```

{: .warning }
> **入れ終わったら、ターミナルを一度閉じて開き直してください。** 開いたままだと
> `node` コマンドが見つからないままです（Windows でとくによく起きます）。

### 確認

```bash
node -v
npm -v
```

両方バージョン番号が出れば完了です。

---

## ステップ 2 — Claude Code を入れてログインする {#step2}

**何のため:** MulmoTerminal のセルの中で動いているエージェント本体です。
起動時に必須チェックされるのは、実はこれ 1 つだけです。

{: .warning }
> **料金の前提。** Claude Code を使うには **Claude の Pro / Max / Team / Enterprise**
> プラン、または **Console（API）アカウント**が必要です。**無料プランには Claude Code は
> 含まれません。** MulmoTerminal 自体は無料（MIT ライセンス）で、こちらに課金は発生しません。
> → [料金の考え方は FAQ](faq.html)

### インストール

公式が推奨しているのは、Node.js に依存しないネイティブ版です。

**macOS**

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Windows（PowerShell）**

```powershell
irm https://claude.ai/install.ps1 | iex
```

パッケージマネージャ派の方は、こちらでも同じものが入ります。

| 環境 | コマンド |
|---|---|
| Homebrew (macOS) | `brew install --cask claude-code` |
| winget (Windows) | `winget install Anthropic.ClaudeCode` |
| npm（全 OS 共通） | `npm install -g @anthropic-ai/claude-code` |

→ 公式手順: [Claude Code のセットアップ](https://code.claude.com/docs/ja/setup)

### ログイン

```bash
claude
```

ブラウザが開くので、画面の指示に従ってログインしてください。
終わったら `/exit` と打つと抜けられます。

### 確認

```bash
claude --version
```

バージョン番号が出れば完了です。出ない・エラーになる場合は `claude doctor` が
原因を教えてくれます（→ [クイックスタート](https://code.claude.com/docs/ja/quickstart)）。

---

## ステップ 3 — git と gh を入れる {#step3}

**急ぐ方は飛ばして構いません。** 無くても MulmoTerminal は起動します
（その機能が使えなくなるだけです）。ただし、この 2 つが入ってはじめて
「同じリポジトリに複数エージェントを衝突なしで走らせる」というこのアプリの本題に入れます。

| コマンド | 効いてくる機能 |
|---|---|
| `git` | [worktree による作業の隔離](features.html)、セルのブランチ表示・未保存ドット・差分パネル、PR フッター |
| `gh` | [PR / Issue 横断ビュー](github.html)、セルからのワンクリック PR 作成 |
| `tmux`（推奨） | [セッション永続化](features.html) — サーバを再起動してもターミナルが生き残る |

### git

- **macOS** — `xcode-select --install` を実行（または `brew install git`）
- **Windows** — [git-scm.com/downloads/win](https://git-scm.com/downloads/win) からインストーラを実行

```bash
git --version
```

### gh（GitHub CLI）

`gh` は [GitHub](https://github.com) の公式コマンドです。GitHub のアカウントが要ります
（無ければ [github.com](https://github.com) で作成してください）。

- **macOS** — `brew install gh`
- **Windows** — `winget install -e --id GitHub.cli`
- 共通 — [cli.github.com](https://cli.github.com)

入れたらログインします。

```bash
gh auth login
gh auth status
```

MulmoTerminal は**この `gh` のログインをそのまま使います**。アクセストークンを
別途どこかに保存させることはありません。

### tmux（推奨）

- **macOS** — `brew install tmux`
- **Linux** — `sudo apt install tmux`
- **Windows** — ネイティブ版はありません。入れなくても動きますが、
  サーバを再起動するとセッションは残りません。

---

## ステップ 4 — 起動する {#step4}

```bash
npx mulmoterminal@latest
```

- 初回はダウンロードに数十秒かかります
- `✓ MulmoTerminal is ready` と出て、ブラウザが自動で開きます
- 開かなければ、自分で `http://localhost:34567` を開いてください
- **止めるときは Ctrl + C**（ブラウザを閉じただけでは止まりません）
- **そのターミナルを見失ったら**、ブラウザの **設定 → MulmoTerminal を終了**、または別の
  ターミナルで `npx mulmoterminal@latest stop`。どちらも動いているサーバを全部止めます。
  新しい版を起動する前にも、これを使ってください

よく使うオプション：

| やりたいこと | 付けるもの |
|---|---|
| 別のポートで動かす | `--port 8080` |
| 特定のフォルダで開く | `--cwd ./my-project` |
| ブラウザを自動で開かせない | `--no-open` |
| 全オプションを見る | `--help` |

---

## 起動できたら、最初にやること {#first-run}

開いた画面が**グリッド**です。マス（セル）1 つが、AI エージェント 1 体に対応します。
空いているセルには**ランチャフォーム**が出ています。

![空きセルのランチャフォーム](../images/grid-launch-form.png)

1. **Claude** を選ぶ
2. **WORKING DIRECTORY** に、作業したいフォルダのパスを入れる
3. 右の再生ボタンを押す

これで 1 体目が動き始めます。あとは同じことを隣のセルでもう一度やれば 2 体目です。
セルの色（作業中＝青／入力・許可待ち＝琥珀／完了＝緑のリング）で、
**どれが自分を待っているか**が分かります。

**すでに Claude Code を使っている方へ。** MulmoTerminal は `claude --resume` と同じ仕組みで、
**いつものディレクトリの会話履歴をそのまま読みます**。移行作業も、説明のやり直しも要りません。

→ 画面の読み方は [基本編](basics.html)、実際の回し方は [応用編](scenarios.html)

---

## 環境チェックと初期設定 — `init` {#init}

「何が足りないのか」を一覧で出すコマンドがあります。何度実行しても問題ありません。

```bash
npx mulmoterminal@latest init
```

- Node のバージョン、`claude` / `git` / `gh` / `glab` / `tmux` / `codex` / `ffmpeg` / `ollama` を
  **`✓`（あり）・`✗`（必須なのに無い）・`○`（任意）** で表示します。Linux では、このホストが
  ファイルダイアログを何で開くかも確認します
- Claude Code の履歴から、**よく使うディレクトリのチップ**を作ります
- `~/.mulmoterminal/config.json` を書き出します（あなたの他の設定は残します）
- `claude` があれば、そのまま対話設定（`/mulmoterminal-config` スキル）に入るか聞かれます

うまく起動しないときの原因切り分けにも、まずこれを使ってください。

---

## うまくいかないとき {#troubleshooting}

| 出てきたもの | 原因と対処 |
|---|---|
| `command not found: node` / `npx` | Node.js が未インストールか、ターミナルを開き直していない → [ステップ 1](#step1) |
| `Claude Code CLI not found.` | `claude` が入っていないか PATH に無い → [ステップ 2](#step2)。`claude --version` で確認 |
| `ERR_MODULE_NOT_FOUND` | **npx のキャッシュ破損**です（パッケージの不具合ではありません）。最初の `npx` が途中で中断されると壊れたキャッシュが残ります。**画面に削除コマンドが表示される**ので、それを実行してから `npx mulmoterminal@latest` をやり直してください |
| `Port 34567 is already in use.` | すでに起動しています。まず `http://localhost:34567` を開いてみてください。本当に別で動かすなら `--port <番号>` |
| `MulmoTerminal is already running` と聞かれる | 2 つ同時に動かすのは**非対応**です（`~/.mulmoterminal` を共有してしまうため）。基本は `N` で止めて、動いている方を使ってください |
| ブラウザが開かない | 手で `http://localhost:34567` を開けば同じです |
| 画面は出るがセルが起動しない | そのディレクトリが存在するか、[ステップ 2](#step2) のログインが済んでいるかを確認 |
| Windows で tmux が無いと言われる | 仕様です。永続化なしで動きます |

それでも解決しないときは、**セッションの中で `/mulmoterminal-bug-report` と打ってください。**
同梱のスキルが症状を聞き、実際の設定とバージョンを読んで仕様や設定で説明がつかないかを先に確かめ、
既知の issue を検索し、それでも残ったものだけを報告にまとめます（環境情報は自動収集、鍵はマスクされます）。

---

## もう少し使い込む人向け {#for-power-users}

ここから先は、起動できたあとの話です。

### 毎回 `npx` を打つのが気になる

グローバルインストールすると `mulmoterminal` だけで起動できます。

```bash
npm install -g mulmoterminal
mulmoterminal
```

ただし**自動更新はされません**。新しいバージョンが出ると起動時にお知らせが出るので、
`npm install -g mulmoterminal@latest` で上げてください。
`npx mulmoterminal@latest` のほうは毎回最新を取りに行きます。
お知らせを止めたい場合は環境変数 `MULMOTERMINAL_NO_UPDATE_CHECK=1` を設定します。

### 設定はどこに置かれるのか

| 場所 | 何の設定か |
|---|---|
| `~/.mulmoterminal/config.json` | 全体の設定（ディレクトリのチップ、ヘッダー、テーマ、通知、モデルなど） |
| プロジェクト直下の `.mulmoterminal.json` | そのプロジェクトだけの設定（色・名前・並び順など） |

`~/.claude/` の既存設定（hooks / MCP / `CLAUDE.md` / 権限）は**書き換えません**。
動いているのはあなたの `claude` そのものなので、これまでどおりに効きます。

設定は画面の **Settings** からも変えられますし、セッションで `/mulmoterminal-config` と
打てば対話で書いてもらえます。→ [設定方法](config.html)

### 他のマシンやスマホから使いたい

サーバは既定で**ループバック（127.0.0.1）だけを待ち受けます**。たまたま開いた悪意ある
サイトからローカルの Claude を操作されるのを防ぐためです。外から使いたい場合は
**SSH ポートフォワード**を推奨します。

スマホから見たい・返事したいだけであれば、そのための経路が別に用意されています。
→ [スマホから使う](phone.html) / [スマホ通知（Web Push）](notifications.html)

---

## 一緒に入れておくコマンド {#cli-tools}

MulmoTerminal は普段の開発ツールを操縦するコックピットなので、`PATH` に何があるかで
使える範囲が決まります。`claude` / `git` / `gh` がグリッドの土台で、残りは 1 行につき
1 機能ぶんです。

ここでの **「必須」は「無いと機能のかたまりごと失われる」**という意味です。
**起動そのものを止めるのは `claude` が無いときだけ**で、`git` / `gh` が無くてもサーバは
立ち上がります（worktree・差分・PR がまるごと使えないので、実用上は必須という扱いです）。
推奨・任意の行は、その 1 機能が消えるだけです。

| | コマンド | 効いてくる機能 | インストール |
| --- | --- | --- | --- |
| **必須** | `claude` | Claude セッションそのもの | [ステップ 2](#step2) |
| **必須** | `git` | [worktree 分離](features.html)、セルのブランチ / 未保存ドット / 差分表示、PR フッター | [ステップ 3](#step3) |
| **必須** | `gh` | [PR / Issue 横断ビュー](github.html)とワンクリック PR 作成 | [ステップ 3](#step3) |
| 任意 | `glab` | 同じことを **gitlab.com** のプロジェクトでも — 一覧・issue から着手・MR 作成 | `brew install glab` のあと `glab auth login` |
| 推奨 | `tmux` | [セッション永続化](features.html) — サーバ再起動でもターミナルが生き残る | `brew install tmux` · `sudo apt install tmux` · Windows ネイティブ版は無し（通常ターミナルにフォールバック） |
| 任意 | `codex` | セルで [Codex セッション](basics.html#claude-and-codex)を Claude と並べて動かす | `npm i -g @openai/codex` |
| 任意 | `ffmpeg` | [GUI パネル](features.html)の mulmo-script プラグインからの動画生成 | `brew install ffmpeg` · `sudo apt install ffmpeg` |
| 任意 | `ollama` | [claude-ollama](claude-ollama.html) — 完全ローカルのモデルで Claude Code を動かす | [ollama.com/download](https://ollama.com/download) |
| Linux のみ | ファイルダイアログ | **Choose a folder** / **Insert a file path** ボタン。サーバが動いているマシンで OS のダイアログを開きます。macOS と Windows は OS 内蔵、**WSL** は Windows 側のダイアログを使うのでインストール不要です。Linux デスクトップではどれか 1 つ必要で、無ければボタンがその旨を表示します（パスを直接入力すれば使えます） | `sudo apt install zenity` · `sudo dnf install zenity` · `kdialog` / `qarma` / `yad` でも可 |

いま何が足りないかは [`init`](#init) が一覧で出します。

なお **Shell**（普通のターミナルとして使う）には何も要りません。空きセルで Shell を選んで
ディレクトリを入れるだけです。ほかのモデルを使いたい場合は
[OpenRouter で別のモデルを使う](providers.html)へ。

---

## 次に読むもの

1. [基本編 — グリッドで今できること](basics.html)（画面の読み方はここ）
2. [よくある質問（FAQ）](faq.html)（既存セッション・Windows・トークン代・他ツールとの違い）
3. [応用編 — シナリオ別の使い方](scenarios.html)
4. [設定方法](config.html)
5. [用語集](glossary.html)

> 英語版は [Getting started](../en/getting-started.html) にあります。
