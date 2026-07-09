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
| **NOTIFICATION SOUND** | 要対応時に鳴らす音（空なら内蔵チャイム、または任意の音声ファイル） |
| **PULL REQUEST REPOS** | 横断 PR/Issue ビューが集約するリポ（`owner/repo`） |
| **LAUNCH COMMANDS** | グリッドセルで Claude 以外に起動できるコマンド（`{ label, command }`） |
| **MCP SERVERS** | 単一ビューのセッションに追加する自分の MCP サーバ |

## グローバル設定 `~/.mulmoterminal/config.json`

```json
{
  "cwdPresets": ["/Users/you/projects/acme-web", "/Users/you/projects/acme-api"],
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
| `cwdPresets` | ランチャの作業ディレクトリ補完 |
| `launchers` | グリッドセルの「OR LAUNCH」に並ぶ起動コマンド |
| `prRepos` | 横断 PR/Issue ビューの対象リポ |
| `buttons` / `chips` | ヘッダーのボタン/チップ（プロジェクト設定とマージ。→ [ヘッダーのカスタマイズ](#header)） |

## プロジェクトごとの `.mulmoterminal.json` {#per-dir}

プロジェクト直下に置くと、**そのディレクトリで開いた端末（グリッドセル）**の見た目・音・ヘッダーを変えられます。

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

**ボタン**（`buttons`）— 稼働中セッションに効く、絵文字/ラベル付きの操作ボタン。設定なしなら従来どおり何も増えません。

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
- `run: "open"` … `url`（ブラウザ, http/https のみ）/ `reveal`（OSのファイルマネージャ: Finder/Explorer/xdg-open）/ `files`（アプリ内エクスプローラ）/ `view`（`prs`/`wiki`/`collections`/`accounting`）。
- `run: "shell"` … `cmd` をコマンドセルで実行（サーバ側で id 解決 + `${変数}` はシェルエスケープ、コマンドはブラウザに渡らない）。
- `${変数}` … `dir` `branch` `repo` `ahead` `behind` `dirty` `agent` `model` `task`。
- `when` … `isGitRepo` / `agent == …` / `repo == …`（`&&` / `||`、`&&` が優先）。

**チップ**（`chips`）— グリッドセルヘッダーの情報チップを並べ替え/非表示 + カスタム。`null`（既定）は従来どおり。

```json
{ "chips": ["ctx", "git", { "label": "env", "text": "⎇ ${branch}", "when": "isGitRepo" }] }
```

- 組み込み `git` / `diff` / `ctx` / `usage` … 並べた順に表示、書かなければ非表示。
- カスタム `{ label, text, when }` … 読み取り専用テキスト（`text` は `${変数}` 展開）。

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
