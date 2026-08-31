---
title: ヘッダーをカスタマイズする — ボタンとチップの入門
nav_title: ヘッダーのカスタマイズ
layout: default
parent: 日本語
nav_order: 10
description: MulmoTerminal のターミナルヘッダーに自分のボタンを足す方法を、スクリーンショット付きで最初から。どのファイルに書くか、アイコンとツールチップ、run の 4 種類（input / shell / open / action）まで。変数・when・チップの一覧はリファレンスへ。
---

# ヘッダーをカスタマイズする
{: .no_toc }

- TOC
{:toc}

よく使う操作が「ターミナルに打ち込む」しかないと、1 日に何十回も同じ文字を打つことになります。
MulmoTerminal は、稼働中セッションのヘッダーに**自分のボタン**を足せます。設定ファイルに数行
書くだけで、`/compact` の送信も、テストの実行も、社内 wiki を開くのも、ワンクリックになります。

このページは**最初の 1 個を足すところから**順に説明します。上から読んでください。

書きはじめてから引くもの —— `${変数}` の一覧、`when` の書き方、チップ、そのまま貼れる
サンプル —— は [ヘッダーのリファレンス](header-reference.html)にまとめてあります。

---

## 1. まずヘッダーを読む {#anatomy}

何も設定していないセルのヘッダーです。2 段あります。

![何も設定していないセルのヘッダー](../images/header-default.png)

| 場所 | 何が出ているか | 設定でどうなるか |
|---|---|---|
| 1 段目 左 | 状態ドット、`⎇ main` などの**情報チップ** | [`chips`](#chips) で並べ替え・非表示・追加 |
| 1 段目 右 | 拡大・寝かせる・閉じるなど**セルの操作** | 変えられません（アプリの構造） |
| 2 段目 左 | `~/acme-api ▾` — **パスメニュー**（後述） | 変えられません |
| 2 段目 右 | **Skill** ドロップダウンと**アイコンのボタン列** | [`buttons`](#first-button) がここに入ります |

**カスタマイズできるのは、この 2 段目の右側**です。上の画像で `⚡ Skill` の右にある小さな
アイコンのうち、いちばん左のクリップが唯一の既定ボタン（**Insert a file path**）で、
残りはアプリ側の固定ボタンです。

> **既定のボタンは 2 つだけです** — **Insert a file path** と、**Open this branch's PR**
> （そのブランチに開いている PR があるときだけ出ます）。以前ここにあった *Reveal in the file
> manager* / *Browse files in the app* / *New terminal here* / GitHub は、下のパスメニューへ
> 移りました。

### パスメニュー — ディレクトリに対する操作はここ {#path-menu}

2 段目の左にあるパス（`~/acme-api ▾`）はボタンです。押すと、そのセルのディレクトリに対する
操作が出ます。

![パスメニュー](../images/header-path-menu.png)

GitHub のリモートが解決できるリポジトリなら、区切り線の下に **Repository / Issues /
Pull requests** も並びます。ここは固定なので設定では変わりません。同じことをボタンでも
やりたい場合は、[`buttons`](#run) に自分で書けば両方出ます。

---

## 2. 最初のボタンを 1 個足す {#first-button}

### どのファイルに書くか {#where}

| ファイル | 効く範囲 |
|---|---|
| `~/.mulmoterminal/config.json` | **すべての**ターミナル |
| `<プロジェクト>/.mulmoterminal.json` | **そのディレクトリで開いたセル**だけ |

**ボタンが出るのはエージェントのセル**（Claude / Codex / Antigravity / Grok / Muse）です。ランチャーの
チップや Shell セル、Run コマンドで開いたターミナルには出ません —— あれはユーザー自身のコマンドラインで、
このアプリが設定したものは何も足さないからです。

まずはプロジェクト側で試すのが安全です。プロジェクトのルートに `.mulmoterminal.json` を作って、
こう書きます。

```json
{
  "buttons": [
    {
      "id": "compact",
      "icon": "compress",
      "label": "Compact this conversation",
      "run": "input",
      "text": "/compact"
    }
  ]
}
```

**サーバの再起動は要りません。** ヘッダーは、作業ディレクトリ・セッション・エージェントが
変わったときと、**ブラウザのウィンドウに戻ってきたとき**に読み直されます。エディタで保存して
ブラウザに切り替えれば、それで反映されます。

### 押すと何が起きるか {#what-happens}

`run: "input"` なので、そのセルで動いている Claude / Codex に `/compact` と**打ち込んで送信**します。
自分でターミナルに切り替えて打つのと同じことが、1 クリックで済みます。

### 大事な落とし穴 — `buttons` を書くと既定は消えます {#replace}

`buttons` を**どこかに 1 つでも書くと、組み込みの既定セットは丸ごと置き換わります**（足されません）。
上の例だけを書くと、**Insert a file path** が消えます。残したいなら自分で並べてください。

```json
{
  "buttons": [
    { "id": "pick-file", "icon": "attach_file", "label": "Insert a file path", "run": "open", "open": { "pickFile": true } },
    { "id": "compact", "icon": "compress", "label": "Compact this conversation", "run": "input", "text": "/compact" }
  ]
}
```

---

## 3. アイコンとツールチップ {#icon-label}

ここが最初につまずくところです。

**`label` は画面に出ません。** ボタンが描くのは**アイコンだけ**で、`label` は
**マウスを乗せたときに出るツールチップ**（ブラウザ標準のもの）になります。

つまり `label` は「そのボタンが何なのか」を伝える唯一の手段です。`Build` のような単語より、
**`Run the tests` のように動作が分かる文**にしてください。ホバーするまで読めないのですから。

| キー | 役割 |
|---|---|
| `icon` | [Material Symbols](https://fonts.google.com/icons) の名前（`compress`、`science`、`menu_book` …）。**画面に出るのはこれだけ** |
| `emoji` | 絵文字を 1 つ。`icon` より優先されます |
| `label` | **必須**。ホバーで出るツールチップ。読み上げ（`aria-label`）にも使われます |

`icon` も `emoji` も書かないと、`bolt`（稲妻）が出ます。全部これだと見分けが付かないので、
必ず `icon` を指定してください。

下は、5 個のボタンを設定したヘッダーです。文字は 1 つも出ていないことに注目してください。

![ボタンを 5 個設定したヘッダー](../images/header-custom.png)

同じ画面を、設定していないセルと並べるとこうなります。左が未設定、右が上の設定を入れたもの。

![未設定のセルと設定済みのセル](../images/header-before-after.png)

---

## 4. `run` の 4 種類 {#run}

ボタンが何をするかは `run` で決めます。4 つしかありません。

### `run: "input"` — エージェントに送る {#run-input}

`text` をそのセッションに打ち込んで送信します。スラッシュコマンドや、決まり文句のプロンプトに。

```json
{ "id": "compact", "icon": "compress", "label": "Compact this conversation", "run": "input", "text": "/compact" }
```

### `run: "shell"` — コマンドを実行する {#run-shell}

`cmd` を**コマンドセル**で実行します。エージェントのセッションは邪魔されません。

```json
{ "id": "test", "icon": "science", "label": "Run the tests", "run": "shell", "cmd": "yarn test" }
```

押すと、こういうセルが開いて結果が出ます。

![run:"shell" のボタンが開いたコマンドセル](../images/header-shell-cell.png)

> `cmd` の中身は**ブラウザに渡りません**。押した時にサーバが `id` から引き直し、`${変数}` を
> シェルエスケープしてから実行します。

### `run: "open"` — 何かを開く {#run-open}

`open` の中に**書いたキー 1 つ**で、開くものが決まります。

**表は、複数書いてしまったときに効く順**（上ほど強い）でもあります。

| キー | 開くもの |
|---|---|
| `pr` | 現在のブランチの PR をブラウザで（**PR が無いときはボタン自体が出ません**）。サーバ側で `url` に解決されるため、**`url` を一緒に書いていても PR のほうが勝ちます** |
| `url` | ブラウザで URL（`http` / `https` のみ） |
| `reveal` | OS のファイルマネージャ（Finder / エクスプローラ / `xdg-open`） |
| `files` | アプリ内のファイルエクスプローラ |
| `view` | アプリ内のビュー：`prs` / `wiki` / `collections` / `accounting`（`diff` も受け付けますが、**現状は専用の画面が無くファイルビューが開きます**。worktree の差分は[差分バッジ](worktree.html#diff-badge)から） |
| `terminal` | そのディレクトリで新しい端末セル |
| `pickFile` | OS のファイル選択ダイアログ。選んだパスを入力欄に挿入します |

```json
{ "id": "handbook", "icon": "menu_book", "label": "Open the team handbook", "run": "open", "open": { "url": "https://example.com/handbook" } }
```

> **1 つのボタンには 1 つだけ書いてください。** 複数書くと上の順で**最初の 1 つだけ**が効き、
> 残りは黙って無視されます。

### `run: "action"` — このセルのエージェントを再起動する {#run-action}

セル自身に効く操作です。今のところ 1 つだけ:

```json
{ "id": "restart", "icon": "restart_alt", "label": "Restart the agent", "run": "action", "action": "restart" }
```

`"restart"` は、エージェントのプロセスを終了して、**同じセル・同じディレクトリ・同じ会話のまま**起動し
直します。ランチャーに戻ってディレクトリを選び直し、*or resume here* から会話を探す必要はありません。
MCP の登録変更・`~/.mulmoterminal/config.json` の編集・plugin の更新が効くようになるのはこれです。
これらはプロセス起動時に一度だけ読まれるからです。

> **resume の代償があり、確認は出ません。** 会話は transcript から読み直され、実際にトークンを消費します。
> 作業中でもエージェントは終了します。組み込みの Restart ボタンはありません。このボタンと
> [`terminal-restart` ショートカット](config.html#keymap)が、再起動する手段のすべてです。

---

---

## 次は {#next}

ここまでで、ボタンは作れます。**書きながら引くもの**は次のページに:

[ヘッダーのリファレンス — 変数・`when`・チップ・レシピ集](header-reference.html){: .btn .btn-purple }

| 探しているもの | 行き先 |
|---|---|
| `${dir}` みたいな変数に何があるか | [変数の一覧](header-reference.html#vars) |
| ボタンを出す条件の書き方 | [`when`](header-reference.html#when) |
| global と project の両方に書いたらどうなるか | [並び順とマージ](header-reference.html#order-merge) |
| ヘッダーの表示（ブランチ、コンテキスト量…）を変えたい | [チップ](header-reference.html#chips) |
| とりあえず動くものを貼りたい | [レシピ集](header-reference.html#recipes) |

---

## 関連 {#related}

- [ヘッダーのリファレンス](header-reference.html) — 変数・`when`・チップ・レシピ集
- [設定 → ヘッダーのカスタマイズ](config.html#header) — 全フィールドのリファレンス
- [設定 → プロジェクトごとの設定](config.html#per-dir) — 色・名前・並び順など、同じファイルの他のキー
- `/mulmoterminal-header` スキル — 対話で書いてもらう場合はこちら
