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
| `providers` | Anthropic 互換の接続先（→ [別のモデルで動かす](#providers)） |

## 別のモデルで動かす（プロバイダ） {#providers}

Claude Code は Anthropic 互換のバックエンドなら何にでも接続できます。MulmoTerminal はその接続先を
`config.json` から、**鍵はサーバを起動したときの環境変数から**読みます。鍵が設定ファイルに入ることはありません。

> Anthropic 自体の認証、セッションに渡る環境変数、必要な許可の一覧、再開時の挙動は
> [モデルとバックエンド](models.html) にまとめてあります。

### 1. 接続先を `~/.mulmoterminal/config.json` に足す

```json
{
  "providers": [
    {
      "id": "openrouter",
      "label": "OpenRouter",
      "baseUrl": "https://openrouter.ai/api",
      "tokenEnv": "OPENROUTER_API_KEY",
      "maxOutputTokens": 16000,
      "models": []
    }
  ]
}
```

| キー | 役割 |
|---|---|
| `id` | `.mulmoterminal.json` や起動時の選択から参照する名前 |
| `baseUrl` | **末尾に `/v1` を付けない** — Claude Code が `/v1/messages` を自分で足すため、付けると `/v1/v1/messages` になって 404 |
| `tokenEnv` | 鍵が入っている環境変数の**名前**（値ではありません） |
| `maxOutputTokens` | 省略時 16000。思考型モデルは出力枠が足りないと考えるだけで終わり、**返答が空**になります |
| `models` | プリセットに加えて選択肢に出したいモデル id |

### 2. 鍵はサーバの環境変数に置く

MulmoTerminal を起動するシェル、または隣に置いた `.env` に書きます。

```bash
OPENROUTER_API_KEY=sk-or-…
```

追加したらサーバを再起動してください。鍵が解決できないプロバイダは**起動を拒否します** — Anthropic に
黙って落とすと、そのディレクトリが選んでいないバックエンドにプロンプトが流れてしまうためです。

### 3. プロジェクトの既定（任意）

```json
{
  "provider": "openrouter",
  "model": "moonshotai/kimi-k2.7-code"
}
```

そのディレクトリで開いた端末はすべてこれで起動します。

### 起動時に選ぶ

プロバイダが 1 つでも使える状態なら、空セルの起動フォームに **MODEL** の選択欄が出ます。選んだ内容は
**そのセッションだけ**に効き、`.mulmoterminal.json` の既定は書き換えません。選ばなければ既定のままです。

選択肢の脇の数字は実測値です。

```
Kimi K2.7 Code · 3/3 · 14s · 262k
```

`3/3` は「ファイルを読んで別のファイルに書く」課題を**実際に完走した回数 / 試行回数**。プロンプトに
流暢に答えても一度もツールを呼ばないモデルが実在するため、この数字が載っています。`14s` は中央値、
`262k` はコンテキスト長です。

- `0/4 — never used a tool` … 応答は返るがツールを使えない
- `not reachable from this account` … 計測した OpenRouter アカウントの
  [プライバシー設定](https://openrouter.ai/settings/privacy)で配信元が全部除外されていたもの。
  **モデルの欠陥ではなく**、別のアカウントなら動く可能性があります
- `not tested` … `models` に自分で足したもの

一覧は `common/modelPresets.ts`、計測スクリプトは `scripts/model-trials.ts` です。

```bash
yarn tsx scripts/model-trials.ts --provider openrouter --trials 3 <model-id>
```

### 制限

Docker サンドボックス（`MULMOTERMINAL_SANDBOX`）とは併用できません。コンテナは環境変数を引き継がず、
そのまま動かすと**選んだはずのプロバイダではなく Anthropic に**接続してしまうため、明示的に拒否します。

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
Anthropic のまま別のモデルを指定できます。→ [別のモデルで動かす](#providers)

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
