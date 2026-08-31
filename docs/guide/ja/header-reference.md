---
title: ヘッダーのリファレンス — 変数・when・チップ
nav_title: ヘッダーのリファレンス
layout: default
parent: 日本語
nav_order: 10.5
description: MulmoTerminal のヘッダー設定を書くときに引くページ。${変数} 12 個の意味と空になる条件、when の全記法（! / != / 空右辺 / 括弧は使えない）、global と project のマージ規則、チップ 6 + 3、そのまま貼れる .mulmoterminal.json のレシピ集。
---

# ヘッダーのリファレンス
{: .no_toc }

- TOC
{:toc}

書きながら引くためのページです。章番号は[入門](header.html)の §1〜4 から**続き**です。

**まだボタンを 1 個も作っていないなら**、先に
[ヘッダーをカスタマイズする](header.html)を上から読んでください —— とくに
[`buttons` を書くと既定のボタンが消える](header.html#replace)ことを知らずに書きはじめると、
ヘッダーを壊します。

---

## 5. `${変数}` — 値を埋め込む {#vars-when}

### 使える 12 個 {#vars}

`text` / `cmd` / `open` の値と、カスタムチップの `text` で使えます。

| 変数 | 入るもの | 空になるとき |
|---|---|---|
| `${dir}` | セルの作業ディレクトリの絶対パス | —— |
| `${dirName}` | その末尾だけ（`mulmoterminal`） | —— |
| `${branch}` | 現在のブランチ名 | **git リポジトリでないとき** |
| `${repo}` | `owner/name`（GitHub の remote から） | **remote が無い / GitHub でないとき** |
| `${remoteUrl}` | remote の URL そのもの | remote が無いとき |
| `${dirty}` | 未コミットの変更**数** | git リポジトリでないとき（`0` は空ではなく `0`） |
| `${ahead}` | upstream より進んでいるコミット数 | upstream が無いとき |
| `${behind}` | upstream より遅れているコミット数 | 同上 |
| `${agent}` | `claude` / `codex` / `antigravity` | —— |
| `${model}` | 動作モデル名 | エージェントが報告するまで |
| `${session}` | セッション ID | —— |
| `${task}` | そのセルがやっている PR / issue の番号 | 紐づいていないとき |

```json
{ "id": "files", "icon": "folder_open", "label": "Browse this project's files", "run": "open", "open": { "files": "${dir}" } }
```

> **空になる = 空文字**です。`null` は空文字に潰れます。`"https://github.com/${repo}"` は
> remote が無いリポジトリで `https://github.com/` という死んだリンクになるので、
> [`when` で出し分け](#when)てください。

#### タイプミスは、そのまま残ります {#unknown-vars}

知らない変数名は**空にならず、書いたまま表示されます**。

```text
${braneh}   →   ${braneh}        （${branch} のタイプミス）
```

黙って空欄になるより気づけるように、そうしています。ボタンのラベルやチップに `${...}` が
そのまま出ていたら、変数名の綴りを疑ってください。

---

## 6. `when` — 出す条件 {#when-section}

### 書き方 {#when}

条件を満たさないボタンは**そもそも描かれません**（押せないボタンが並ぶより良いので）。
チップにも同じように書けます。

| 書き方 | 意味 |
|---|---|
| `isGitRepo` | git リポジトリのとき |
| `!isGitRepo` | git リポジトリ**でない**とき |
| `agent == claude` | このセルが Claude のとき（`codex` / `antigravity` も） |
| `agent != claude` | Claude **以外**のとき |
| `repo == owner/name` | そのリポジトリのとき |
| **`repo != `**（右辺を空） | **`${repo}` が何かに解決できるとき** |

`&&` と `||` で繋げられます。**`&&` が優先**です。

```text
agent == claude && isGitRepo
```

> **括弧は使えません。** `(a || b) && c` のような書き方はできないので、条件が複雑になるときは
> ボタンを 2 つに分けてください。

### 「git リポジトリか」と「GitHub の repo 名が取れるか」は別物 {#when-repo}

ここが一番間違えるところです。GitHub を開くボタンにこう書くと:

```json
{ "id": "gh", "run": "open", "when": "isGitRepo", "open": { "url": "https://github.com/${repo}" } }
```

**remote が無いリポジトリでも、GitHub 以外の remote でも、ボタンが出ます。** どちらも
「git リポジトリ」ではあるからです。そして `${repo}` が空に解決されるので、押すと
`https://github.com/` が開きます。

正しくは、**値が取れることを条件にします**:

```json
{
  "id": "gh",
  "icon": "open_in_new",
  "label": "Open this repo on GitHub",
  "run": "open",
  "when": "repo != ",
  "open": { "url": "https://github.com/${repo}" }
}
```

`repo != ` の右辺は**空のまま**です。「`repo` が空でない」＝「解決できる値がある」。
`${変数}` を URL やコマンドに埋める全てのボタンで、この形が要ります。

> `when` は**表示の出し分けだけ**で、セキュリティの境界ではありません。`run: "shell"` を
> 実行できる根拠は「そのコマンドがあなたの設定ファイルに書いてある」ことです。

---

## 7. 並び順と、2 つの設定ファイルの関係 {#order-merge}

- **`order`**（数値）で並びます。書かなかったボタンは後ろに回り、同じ値どうしは書いた順のままです。
- **global と project は `id` でマージされます。** 同じ `id` があればプロジェクト側が勝ち、
  無ければ足されます。つまり全体に共通のボタンを global に置き、プロジェクト固有のものだけ
  `.mulmoterminal.json` に書けます。
- ただし**組み込みの既定セット**は、どちらか一方でも `buttons` を書いた時点で置き換わります
  （→ [落とし穴](#replace)）。
- `chips` はマージ**されません**。プロジェクト側があれば、そちらが丸ごと勝ちます。
- 上限は `buttons` が 32 個、`chips` が 16 個です。

---

## 8. チップ — ヘッダーに情報を出す {#chips}

`chips` は 1 段目の情報表示を並べ替え・非表示にし、自分のものを足します。書かなければ既定のままです。

```json
{ "chips": ["git", "ctx", { "label": "Which environment this project deploys to", "text": "env staging" }] }
```

### 効くのは 6 つだけ {#builtin-chips}

| id | 出るもの | |
|---|---|---|
| `git` | ブランチと未保存の数（`⎇ main ●1`） | ✅ 制御できます |
| `work` | このセルがやっている PR / issue（`#977 → #966`） | ✅ |
| `diff` | worktree の差分バッジ（`+2 ●5`） | ✅ [worktree のセルで、変更があるときだけ](worktree.html#diff-badge) |
| `ctx` | モデルとコンテキスト使用率 | ✅ エージェントが報告してから |
| `usage` | レート制限の消費率 | ✅ 同上 |
| `env` | このワーキングツリーに配られた値。ポートは `:3010` でクリックでき、それ以外はそのまま表示 | ✅ [プロジェクトが `worktreeEnv` を宣言しているときだけ](config.html#worktree-env) |
| `dir` / `status` / `tools` | プロジェクトバッジ / 状態ドット / ツール履歴 | ❌ **構造なので、書いても効かず、書かなくても消えません** |

`dir` / `status` / `tools` を書いてもエラーにはならず、黙って無視されます。

### カスタムチップ {#custom-chips}

`{ "label": …, "text": …, "when": … }` で読み取り専用のテキストを足せます。

**表示されるのは `text` です。`label` はここでもツールチップ**（ボタンと同じ）。
`text` では `${変数}` が展開されます。

上のスクリーンショットの右のセルにある `env staging` が、このカスタムチップです。

> **`chips` を書いたら、欲しいものは全部書いてください。** 書いたリストがそのまま全部になるので、
> `work` を落とすと PR / issue の表示も消えます。

---

## 9. Skill メニューを絞り込む {#skills}

ヘッダーの **⚡ Skill** は、そのディレクトリで使えるスキルを一覧します（プロジェクトの
`.claude/skills` が先、次に `~/.claude/skills`。それぞれの中はアルファベット順で、同じ slug が
両方にあればプロジェクト側が勝ちます）。選ぶと**今のセッション**でそれを実行します
（Claude は `/<slug>`、他のエージェントは `Use the "<slug>" skill.`）。

![Skill メニュー](../images/header-skill-menu.png)

数が増えて選びにくくなったら、プロジェクトの `.mulmoterminal.json` に `skills` を書くと、
**その slug だけを、その並び順で**出す許可リストになります。

```json
{ "skills": ["review-diff", "commit-msg"] }
```

- 書かなければ**全部**出ます。
- 存在しない slug は無視されます。
- **これはプロジェクト単位の設定です。** global の `config.json` には書けません。

---

---

## 10. レシピ集 {#recipes}

そのまま貼れる形です。**`buttons` は書いた瞬間に既定を置き換える**ので、
[既定の 2 つ](header.html#replace)が要るなら一緒に書いてください。

### そのまま貼れる `.mulmoterminal.json` {#recipe-full}

Node のプロジェクト向け。既定の 2 ボタンを残したうえで、ビルド・テスト・GitHub を足しています。

```json
{
  "buttons": [
    { "id": "pick-file", "icon": "attach_file", "label": "Insert a file path", "run": "open", "open": { "pickFile": true }, "order": 1 },
    { "id": "pr", "icon": "merge", "label": "Open this branch's PR", "run": "open", "when": "isGitRepo", "open": { "pr": true }, "order": 2 },
    { "id": "build", "icon": "build", "label": "yarn build", "run": "shell", "cmd": "yarn build", "order": 10 },
    { "id": "test", "icon": "science", "label": "yarn test", "run": "shell", "cmd": "yarn test", "order": 11 },
    { "id": "gh", "icon": "open_in_new", "label": "Open this repo on GitHub", "run": "open", "when": "repo != ", "open": { "url": "https://github.com/${repo}" }, "order": 20 },
    { "id": "compact", "icon": "compress", "label": "Compact this conversation", "run": "input", "text": "/compact", "when": "agent == claude", "order": 30 }
  ],
  "chips": ["git", "work", "ctx", "usage"]
}
```

### 断片 {#recipe-snippets}

**いま開いているブランチを GitHub で比較する** —— `${branch}` が要るので `isGitRepo` で足ります。

```json
{ "id": "compare", "icon": "compare_arrows", "label": "Compare this branch on GitHub", "run": "open", "when": "repo != ", "open": { "url": "https://github.com/${repo}/compare/${branch}" } }
```

**Claude のときだけ `/compact`** —— `codex` のセルには出ません。

```json
{ "id": "compact", "icon": "compress", "label": "Compact this conversation", "run": "input", "text": "/compact", "when": "agent == claude" }
```

**git リポジトリでないときだけ、初期化を促す** —— `!` の使いどころです。

```json
{ "id": "init", "icon": "add_circle", "label": "git init here", "run": "shell", "cmd": "git init", "when": "!isGitRepo" }
```

**このセルのエージェントを再起動する** —— [代償があります](header.html#run-action)。

```json
{ "id": "restart", "icon": "restart_alt", "label": "Restart the agent", "run": "action", "action": "restart" }
```

**遅れているコミット数を、チップで常に見る**

```json
{ "label": "How far behind upstream this branch is", "text": "↓${behind}", "when": "isGitRepo" }
```

---

## 関連 {#related}

- [ヘッダーをカスタマイズする](header.html) — 入門。最初の 1 個から
- [設定 → ヘッダーのカスタマイズ](config.html#header) — 全フィールドのリファレンス
- [設定 → プロジェクトごとの設定](config.html#per-dir) — 色・名前・並び順など、同じファイルの他のキー
- [worktree](worktree.html) — `diff` チップと `worktreeEnv`
- `/mulmoterminal-header` スキル — 対話で書いてもらう場合はこちら
