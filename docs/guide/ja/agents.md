---
title: どの coding agent を使うか
layout: default
parent: 日本語
nav_order: 7
description: MulmoTerminal のセルで動かせる coding agent の一覧 — Claude Code / Codex / Antigravity / Grok / Muse / GitHub Copilot CLI / Cursor CLI。それぞれ何をインストールする必要があるか、会話をどう再開するか、GUI ツールにどう到達するか、そして Claude Code を別のバックエンドや自分のコマンドラインで動かす方法。
---

# どの coding agent を使うか

1つのセルで動くエージェントは**1つ**で、空のセル上部の **Agent Picker** で選びます。first-class な
エージェントは7つ、それに **Shell**（これはエージェントではありません）。

**互換ではありません。** 各エージェントは会話を自分の場所に持つので、**その会話を続けられるのは
書いた本人だけ**です。ピッカーを切り替えると「or resume here」に出る一覧も変わります。そして
GUI ツールへの到達方法が3通りに分かれていて、選ぶ前に読む価値があるのはここです。

---

## 7つのエージェント {#at-a-glance}

| | Agent Picker | コマンド | バッジ | GUI ツールの到達方法 | モデル指定 |
|---|---|---|---|---|---|
| **Claude Code** | Claude *(既定)* | `claude` | — | セッションごとの URL | Model picker、または `providers` |
| **Codex** | Codex | `codex` | `cx` | セッションごとの URL | `CODEX_MODEL` |
| **Antigravity** | Antigravity | `agy` | `agy` | ディレクトリのファイル | `ANTIGRAVITY_MODEL` |
| **Grok** | Grok | `grok` | `gk` | ディレクトリのファイル | `GROK_MODEL` |
| **Muse** | Muse | `muse` | `mu` | プラグイン（マシン単位） | `MUSE_MODEL` |
| **GitHub Copilot CLI** | Copilot | `copilot` | `cp` | セッションごとの URL | `COPILOT_MODEL` |
| **Cursor CLI** | Cursor | `cursor-agent` | `cu` | ディレクトリのファイル *（まだ自動では書きません）* | `CURSOR_MODEL` |

どのコマンドも `CLAUDE_BIN` / `CODEX_BIN` / `ANTIGRAVITY_BIN` / `GROK_BIN` / `MUSE_BIN` /
`COPILOT_BIN` / `CURSOR_BIN` で差し替えられます（バージョン固定、ラッパー、`PATH` の外にある
パスなど）。

**どれが「終わった」を教えてくれるか。** Claude と Cursor は処理中と完了の両方を出すので、見て
いないセルでも注目マークが付き、音が鳴ります。Codex と Copilot は処理中のみ。Antigravity・Grok・
Muse はどちらも出しません（セルは正常に動き、ただ静かなだけです）。**入力待ちを知らせられるのは
Claude と、6.2.0 からの Codex**です。Codex は、最初の Codex セルで聞かれる hook の確認に答えて
からになります（[6.2.0 のガイド](v6.2.0.html)）。他のエージェントでは承認プロンプトが無音のまま
セルに表示されます。

**使わないエージェントは入れる必要がありません。** コマンドが無いエージェントは、新規セルの Agent
Picker で**薄く表示されます**。選ぶと、起動できない理由と公式のインストール方法へのリンクが出て、開始ボタンは
押せないままです。他のエージェントには影響しません。この確認は MulmoTerminal の起動時に1回だけ行うので、
**インストールしたら MulmoTerminal を再起動してください**。既定のエージェントが無くて `npx mulmoterminal`
が起動を止めるときも、同じインストール方法を案内します。

---

## GUI ツールへの到達方法（ここが本当の違い） {#gui-tools}

「GUI ツール」は MulmoTerminal 自身の MCP ツールで、Canvas にチャートを描いたりワークスペースの
データを読んだりするものです。`render` / `data` / `media` / `external` の4グループに分かれます。

到達方法は **3通り**あり、どれになるかは**そのエージェントの CLI の性質**であって、設定で変えられる
ものではありません。

### 1. セッションごとの URL — Claude Code / Codex / Copilot

**ワークスペース**では、この3つはセッションごとに生成される1つの URL で**全ツール**を受け取ります。
登録も切り替えも不要で、ランチャーのフォームにはツールグループのトグル自体が出ません（出しても
足せるものが無いため）。

**プロジェクトディレクトリ**では、そのディレクトリが登録したグループだけを、やはり spawn ごとの
フラグで受け取ります（ファイルを読みに行く2番とは別の道です）。

### 2. ディレクトリのファイル — Antigravity / Grok / Cursor

この3つはいずれも spawn 時に URL を渡せないので、**ディレクトリの設定ファイル**を自分で読み、そこに
登録されているものだけを得ます。ワークスペースでも同じです。

- **Antigravity** は MulmoTerminal がディレクトリのトグルから書く JSON を読みます。トグルを切り替える
  たびに書き直され、MulmoTerminal が書いていないサーバーはそのまま残し、`git status` にも出ません。
- **Grok** は `.grok/config.toml` を読みます。これはユーザーのファイルなので、MulmoTerminal は直接
  書かず `grok mcp add` を駆動します。
- **Cursor** は `.cursor/mcp.json` を読みます。MulmoTerminal はディレクトリのトグルからこのファイルを
  書きますが、書くのは**そのディレクトリで cursor のセルを起動したとき**で、トグルを切り替えた瞬間では
  ありません（Antigravity はトグル時に書き直します）。どちらにせよ反映されるのは次に起動する
  セッションからで、動いているセッションには届きません。そのうえで cursor だけもう 1 手あります。cursor は
  **承認していない MCP サーバーを読み込まず、しかも未承認であることを黙って伏せます**（プロンプトも
  エラーも出ず、単に「MCP サーバーが無い」と見えます）。そこでセル起動時に
  `cursor-agent mcp enable` で、こちらが書いたサーバーだけを承認します。あなた自身が書いた項目は
  そのまま残り、ファイルを `git status` から隠すのは MulmoTerminal が新規に作った場合だけです。

なので Antigravity・Grok・Cursor のどれかを選んでいるときは、ワークスペースでも4つのトグルが出た
ままになります。それが正確な答えで、ディレクトリのファイルがこの3つにとって GUI ツールを得る唯一の
道だからです。

### 3. プラグイン（マシン単位）— Muse *(4.7.0 で対応)* {#muse-plugin}

Muse は URL を渡す方法も、ディレクトリごとの設定ファイルもありません。MCP サーバーは
**インストールされたプラグイン**が宣言し、`muse plugins install` は**マシン単位**で記録します —
あるディレクトリからインストールしても、そのディレクトリには何も書かれません。

そこで MulmoTerminal は**4グループ全部を持つプラグインを1つ**登録し、**セッションごとに**「その
ディレクトリで有効にされているもの」まで絞ります。プラグインのインストールと承認は Muse 自身の CLI
を通して行い、内容が変わっていなければサブプロセスすら起動しません。

そのセッションに権限が無いグループは、エラーではなく**空のツールセット**を返します。エラーにすると、
1グループだけ有効にしたセルに壊れたサーバーが3つ並んで見えてしまうためです。

知っておくとよい点が2つ:

- **プラグインはマシン全体に入ります。** MulmoTerminal が起動したものでない Muse セッションからも
  `muse plugins list` に見えます。それらはセッションが解決できないので何も提供しません。消すには
  `muse plugins remove mulmoterminal`。次の Muse セルが再登録します。
- **Muse のプラグイン機能は Muse 側の実験的フラグの下にあります。** 将来の Muse が名前を変えたり
  外したりしても、Muse セルは起動します — GUI ツールが無くなり、警告が1行出るだけです。

---

## 会話の再開 {#resume}

**OR RESUME HERE** には、そのディレクトリの会話のうち **Agent Picker で選んでいるエージェントのもの**
だけが並びます。保存場所がエージェントごとに別なので、混ざることはありません。

| | 会話の置き場所 |
|---|---|
| Claude Code | 自身の transcript ディレクトリ |
| Codex | セッションごとに書く rollout ファイル |
| Antigravity | 自身の会話ストア |
| Grok | ディレクトリをキーにした自身のストア |
| Muse | SQLite のセッションインデックス＋セッションログ |
| GitHub Copilot CLI | `~/.copilot/session-state/<id>/` と、マシン単位の SQLite インデックス |
| Cursor CLI | `~/.cursor/projects/<slug>/agent-transcripts/<id>/` |

再開した Muse セッションは `--workspace` を保ちます。これがワークスペースのツールを登録している
ものなので、これを落とすと**会話は戻るのにツールが無い**状態になっていました（4.7.0 で修正）。

**Muse の再開にシードプロンプトは渡せません。** Muse は resume のコマンドラインでプロンプトを
受け付けないので、シードは新規セッションのときだけ送られます。

---

## ヘッダーのバッジ

Claude 以外のセルには短いバッジ（`cx` / `agy` / `gk` / `mu` / `cp` / `cu`）が付き、何が動いているか一目で分かり
ます。その横にモデル名とコンテキスト使用率、上下の矢印はそのセッションのトークン使用量です。

Muse のコンテキスト表示は「**直近の完了した呼び出し**の値」で、それまでの最大値ではありません。
最大値だとコンパクションの後も下がらず、必要が無いのに `/compact` を促してしまっていました
（4.7.0 で修正）。

---

## Shell はエージェントではありません

**Shell** は OS 標準シェル（`$SHELL`）を起動します。インストールも設定も不要で、会話も GUI ツールも
ありません。

ピッカーの下にある **launch commands** も同じ考え方で、**書いたコマンドラインをそのまま**実行します。
MulmoTerminal はその中身を読みません。だからコマンドが `claude` という launch command は、
**Claude Code が入った端末**であって**エージェントセッションではありません** — セッション ID も
再開もバッジも GUI ツールもありません。エージェントを起動するのは Agent Picker です。

---

## Claude Code を別のやり方で動かす {#claude-variants}

「Claude」の意味を広げるものが2つあり、どちらも **Claude 専用**です。

### 別のバックエンド / モデル — `providers`

`~/.mulmoterminal/config.json` の `providers` エントリで、**Anthropic 互換**のバックエンド
（OpenRouter、Moonshot、ローカルの Ollama ブリッジ、社内ゲートウェイなど）を登録できます。登録すると
Model picker に Anthropic のモデルと並んで出ます。ディレクトリごとに `provider` / `model` を固定
すれば、そのプロジェクトは常に同じもので動きます。

設定方法、組み込みモデル一覧の実測通過率、セッションの中からは診断しにくい設定ミスについては
[プロバイダーとモデル](providers.html)。

### 自分のコマンドライン — `customAgents`

`customAgents` エントリは、**あなた自身の** Claude Code の起動方法です（ラッパースクリプト、
バージョン固定したバイナリ、`ollama launch claude --model … --` など）。登録すると上記7つと並んで
Agent Picker に出ます。Claude Code の argv がまるごと後ろに付くので、セッションは再開でき、コストも
報告され、GUI ツールも得られます。

launch command との違いはここです: エントリが `agent: "claude"` を宣言しているので、MulmoTerminal は
**どの CLI の引数を付ければよいか分かっている**。**対応しているのは Claude だけ**で、他のエージェント
名を書いても動くラベルにはなりません。

エントリの書式は[設定](config.html#custom-agents)を参照。

---

## Claude Code なしで起動する {#default-agent}

`npx mulmoterminal` は `claude` が見つからないと起動を拒否します。これは意図的な設計です —
ほとんどの環境が Claude Code を使っており、黙って別のエージェントで起動すると「今どれが
応答しているのか」が分からなくなるためです。しかし Codex や Copilot だけで作業していて
Claude Code を入れていない場合、このゲートがアプリそのものを塞いでしまいます (#2082)。

**既定エージェントを宣言すると、チェックはその宣言に従います。** 次のどちらでも構いません:

```bash
npx mulmoterminal --agent codex
```

`~/.mulmoterminal/config.json`:

```json
{ "defaultAgent": "codex" }
```

フラグが設定ファイルより優先され、フラグは書き戻されません — 1 回の起動についての指定だからです。
指定できるのは 7 つのエージェント id です: `claude`, `codex`, `antigravity`, `grok`, `muse`,
`copilot`, `cursor`。

宣言すると、変わるのはちょうど 2 つです:

1. **起動時のチェック対象が Claude Code から、そのエージェントに変わります。** 必須である点は
   同じです — 自分で指定した以上、それが無いマシンでは頼んだことができないので、空のグリッドを
   見せるより理由を伝えます。見つからない場合は、探したコマンド名と、上書き用の `<AGENT>_BIN`
   を示します。
2. **新しいセルがそのエージェントで開きます。** Agent Picker の初期値が Claude ではなくなります。

### 変わらないこと {#default-agent-not}

**すでに保存したセルは、保存したときのエージェントのままです。** グリッドのセルは Claude 以外の
ときだけエージェントを記録するので、Claude のセルは「そのフィールドが無い」状態で保存されます。
これは `defaultAgent` を後からどう変えても永続的に「Claude」を意味します。この設定を変えても
既存のセルが別のエージェントに付け替えられることはありませんし、Agent Picker を一度でも操作した
ブラウザは、その記憶した選択を保ちます。

「*既定*エージェント」という名前なのはそのためです — 新しく作るものの初期値を決めるだけです。

### `CLAUDE_BIN` は尊重されます {#claude-bin}

Claude Code を `PATH` の外に置いている場合は `CLAUDE_BIN` にフルパスを設定すれば起動時に
見つかります。以前は、サーバが `CLAUDE_BIN` を使う一方で起動チェックは `PATH` 上の
`claude` という語を直接探していたため、正常なインストールでも拒否されることがありました。
これは修正済みです。各エージェントに同じ上書きがあります — `CODEX_BIN`, `GROK_BIN`,
`CURSOR_BIN` など。

---

## リンク

- [基本編 — 画面の読み方](basics.html) — ランチャーのフォームを1つずつ
- [プロバイダーとモデル](providers.html) — Claude セッションのバックエンド
- [設定](config.html) — 全設定。`customAgents` もここ
- [Canvas と GUI パネル](features.html) — GUI ツールグループが実際に何をするか
