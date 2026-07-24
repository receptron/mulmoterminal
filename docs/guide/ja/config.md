---
title: 設定方法
layout: default
parent: 日本語
nav_order: 4
---

# 設定方法
{: .no_toc }

- TOC
{:toc}

設定は 3 か所にあります。**設定モーダル（⚙）**・**グローバル設定 `~/.mulmoterminal/config.json`**・
**プロジェクトごとの `<project>/.mulmoterminal.json`**。ボタン/チップは両ファイルがマージされます。

---

## 設定モーダル（⚙）

ツールバーの ⚙ から開きます。

![設定モーダル](../images/settings.png)

| 項目 | 内容 |
|---|---|
| **THEME** | Midnight / Nord / Daylight / Solarized Light |
| **DIRECTORY APPEARANCE** | 「🎨 Configure appearance…」— ディレクトリの名前バッジ・色・ヘッダーを対話的に設定 |
| **NOTIFICATION SOUND** | 要対応時に鳴らす音（空なら内蔵チャイム、または任意の音声ファイル） |
| **WEB PUSH NOTIFICATIONS** | 「Notify my devices when a task finishes」トグル（既定 OFF → [スマホ通知](notifications.html)） |
| **GOOGLE ACCOUNT** | Calendar 連携用の Google サインイン（RemoteHost の Connect とは別物） |
| **PULL REQUEST REPOS** | 横断 PR/Issue ビューが集約するリポ（`owner/repo`） |
| **LAUNCH COMMANDS** | グリッドセルで Claude 以外に起動できるコマンド（`{ label, command }`） |
| **MCP SERVERS** | 単一ビューのセッションに追加する自分の MCP サーバ |
| **COST (ESTIMATED)** | Session / Today / Month の推定コスト表示 |

## グローバル設定 `~/.mulmoterminal/config.json`

```json
{
  "cwdPresets": [
    { "label": "acme-web", "path": "/Users/you/projects/acme-web" },
    { "label": "acme-api", "path": "/Users/you/projects/acme-api" }
  ],
  "launchers": [
    { "label": "Shell", "command": "$SHELL" },
    { "label": "Node REPL", "command": "node" }
  ],
  "prRepos": ["acme/web", "acme/api"],
  "userMcpServers": [],
  "buttons": [],
  "chips": null
}
```

| キー | 役割 |
|---|---|
| `cwdPresets` | ランチャに並ぶ作業ディレクトリのチップ（`{ label, path }`。クリックで欄に入力、▶ で即起動） |
| `launchers` | グリッドセルの「OR LAUNCH」に並ぶ起動コマンド |
| `prRepos` | 横断 PR/Issue ビューの対象リポ |
| `buttons` / `chips` | ヘッダーのボタン/チップ（プロジェクト設定とマージ。→ [ヘッダーのカスタマイズ](#header)） |
| `providers` | Anthropic 互換の接続先（→ [OpenRouter で別のモデルを使う](providers.html)） |
| `soundFile` | カスタム通知音（音声ファイルの絶対パス。設定モーダルからも変更可） |
| `pushEnabled` | Web Push トグルの保存先（既定 `false` → [スマホ通知](notifications.html)） |
| `worklogEnabled` / `worklogIntervalHours` | 定期 dev-work ログ（既定 OFF / 6 時間） |

## 別のモデルで動かす（プロバイダ） {#providers}

Claude Code は Anthropic 互換のバックエンドなら何にでも接続できます。接続先は `config.json` の
`providers`、**鍵はサーバの環境変数**（設定ファイルには書きません）、既定のモデルはプロジェクトの
`.mulmoterminal.json`。そのうえで**起動時にセッション単位で選べます**。

```json
{
  "providers": [
    { "id": "openrouter", "label": "OpenRouter", "baseUrl": "https://openrouter.ai/api", "tokenEnv": "OPENROUTER_API_KEY", "maxOutputTokens": 16000 }
  ]
}
```

`baseUrl` の末尾に `/v1` を付けないこと、`tokenEnv` は鍵ではなく**変数の名前**であることに注意。

→ **手順・検証済みモデル一覧・モデルの追加方法・トラブルシューティングは
[OpenRouter で別のモデルを使う](providers.html) にまとめてあります。**

## プロジェクトごとの `.mulmoterminal.json` {#per-dir}

プロジェクト直下に置くと、**そのディレクトリで開いた端末（グリッドセル）**の見た目・音・ヘッダーを変えられます。

### 使うモデル

```json
{
  "provider": "openrouter",
  "model": "moonshotai/kimi-k2.7-code"
}
```

そのディレクトリのセッションが既定で使うバックエンドとモデル。`provider` を省いて `model` だけ書くと
Anthropic のまま別のモデルを指定できます。→ [OpenRouter で別のモデルを使う](providers.html)

### 名前バッジと色

```json
{
  "name": "acme-web",
  "badgeColor": "#2563eb",
  "headerColor": "#0b2545",
  "headerTextColor": "#e6f0ff",
  "cellColor": "#0e1117",
  "cellBorderColor": "#1f6f4f",
  "dotColor": "#22c55e",
  "buttonColor": "#a7f3d0"
}
```

すべて `#rrggbb`。作業中/要対応の状態色は、これらの背景色より優先されます（アイドル時に反映）。

### ターミナル自体の色（xterm パレット）

`headerColor` などが「**枠**（ヘッダー・セル）」の色なのに対し、**`colors`（と `theme`）は端末の中身（xterm）**を染めます。
`colors` は xterm の ITheme——`background` / `foreground` / `cursor` や `red` `green` … の ANSI 16 色——を上書きできます。

```json
{
  "name": "🌌 van-gogh",
  "headerColor": "#0b1a4a",
  "headerTextColor": "#f2e29b",
  "colors": { "background": "#0a1330", "foreground": "#f2e29b", "cursor": "#f5b301" }
}
```

`theme` に `midnight` / `nord` / `daylight` / `solarized` を指定するとプリセットのパレットになり、`colors` はその上へ部分上書き。
[応用編 6](scenarios.html) の色分けスクショは、ヘッダー色と `colors` を組み合わせて**ヘッダーから端末の中身まで**プロジェクトごとに染めた例です。

### ヘッダーのカスタマイズ（ボタン / チップ） {#header}

MulmoTerminal の「**拡張**」の柱がここ。稼働中ターミナルのヘッダーを、**小さな DSL** で自分のワークフローに合わせて成形できます。
どんな開発者でも、よく使う操作をワンクリックにし、見たい情報だけを出せる——それがこの仕組みの狙いです。

**ボタン**（`buttons`）— 稼働中セッションに効く操作ボタン。表示は `emoji` または `icon`（Material Symbol 名）＋ `label`、`order` で並び順を指定できます。
未設定なら**組み込みの既定セット**が表示されます: 📎 ファイルパス挿入・📂 ファイルマネージャで開く・📁 アプリ内でファイル一覧・🖥 このディレクトリで新規ターミナル・🔗 このブランチの PR（git リポかつ PR がある時のみ）。`buttons` をどこかで書くと既定セットは**丸ごと置き換え**られます（マージ**されません**）。つまり自分のリストを書けば——**短い**リストでも——並べ替え・削減・差し替えができます。

```json
{
  "buttons": [
    { "id": "compact", "emoji": "🗜️", "label": "Compact", "run": "input", "text": "/compact", "when": "agent == claude" },
    { "id": "gh",      "emoji": "🌐", "label": "Open on GitHub", "run": "open", "open": { "url": "https://github.com/${repo}" }, "when": "isGitRepo" },
    { "id": "reveal",  "emoji": "📁", "label": "Reveal folder", "run": "open", "open": { "reveal": "${dir}" } },
    { "id": "build",   "emoji": "🔨", "label": "Build", "run": "shell", "cmd": "yarn build" }
  ]
}
```

- `run: "input"` … 稼働中の Claude/Codex に `text` を送信（例 `/compact`）。
- `run: "open"` … `url`（ブラウザ, http/https のみ）/ `reveal`（OSのファイルマネージャ: Finder/Explorer/xdg-open）/ `files`（アプリ内エクスプローラ）/ `pickFile`（OSのファイル選択でパス挿入）/ `terminal`（そのディレクトリで新しい端末セルを開く）/ `pr`（現在ブランチの PR をブラウザで開く）/ `view`（`diff`/`prs`/`wiki`/`collections`/`accounting`）。
- `run: "shell"` … `cmd` をコマンドセルで実行（サーバ側で id 解決 + `${変数}` はシェルエスケープ、コマンドはブラウザに渡らない）。
- `${変数}` … `dir` `dirName` `branch` `repo` `remoteUrl` `ahead` `behind` `dirty` `agent` `model` `task` `session`。
- `when` … `isGitRepo` / `agent == …` / `repo == …`（`&&` / `||`、`&&` が優先）。

**チップ**（`chips`）— グリッドセルヘッダーの情報チップを並べ替え/非表示 + カスタム。`null`（既定）は従来どおり。

```json
{ "chips": ["ctx", "git", { "label": "env", "text": "⎇ ${branch}", "when": "isGitRepo" }] }
```

- 組み込み `dir` / `git` / `diff` / `ctx` / `usage` / `status` / `tools` … 並べた順に表示、書かなければ非表示。
- カスタム `{ label, text, when }` … 読み取り専用テキスト（`text` は `${変数}` 展開）。

### ⚡ Skill メニューの絞り込み（`skills`）

ヘッダーの **⚡ Skill ▾** はそのディレクトリで使えるスキル（`<project>/.claude/skills` と `~/.claude/skills`）を一覧します。working dir（プロジェクト）のスキルが先頭、その後にユーザースコープ。選ぶと**今のセッション**でそのスキルを実行します（Claude は `/<slug>`、Codex は `Use the "<slug>" skill.`）。

`skills` を書くと**その slug だけを、その並び順で**表示する許可リストになります。**書かなければ全部**表示。

```json
{ "skills": ["review-diff", "commit-msg"] }
```

- スキル名（slug）は英数字始まりで `a-z 0-9 - _` のみ。存在しない slug は無視されます。

## スクリプト `<project>/script.json`

グリッドセルで実行できるプロジェクトのスクリプト（dev サーバ・テスト・ビルドなど）。

```json
{ "scripts": [ { "label": "dev", "command": "yarn dev" }, { "label": "test", "command": "yarn test", "cwd": "." } ] }
```

## 環境変数

| 変数 | 既定 | 役割 |
|---|---|---|
| `CLAUDE_CWD` / `--cwd` | 実行したディレクトリ（`npx mulmoterminal`。サーバを直接起動した場合のみ `~/mulmoclaude`） | 既定の作業ディレクトリ（PTY の cwd）。`--cwd` でも指定可 |
| `PORT` | `34567` | サーバのポート |
| `MULMOTERMINAL_HOME` | `~/.mulmoterminal` | 管理下 git worktree のルート |

---

← [機能一覧に戻る](features.html) ／ [日本語ガイドの目次](index.html)
