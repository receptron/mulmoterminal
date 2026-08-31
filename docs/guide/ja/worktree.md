---
title: git worktree で作業を隔離する — 作成から片付けまで
nav_title: worktree
layout: default
parent: 日本語
nav_order: 5
description: MulmoTerminal の git worktree の使い方を通しで。worktree の作り方、1 worktree = 1 セッションの制約、差分バッジと PR、閉じるときの片付け、プロジェクト設定の引き継ぎまで。
---

# git worktree で作業を隔離する
{: .no_toc }

- TOC
{:toc}

同じリポジトリで**エージェントを 2 体以上動かすと、互いのファイルを踏みます**。片方が
`src/index.ts` を書き換えている最中に、もう片方が同じファイルを読んで別の結論を出す——
そうならないように、MulmoTerminal はタスクごとに **git worktree** を切って、そこでセッションを
起動できます。

worktree そのものの説明は[用語集](glossary.html#git-worktree)に。ここでは
**作る → 中で作業する → 片付ける**を通しで扱います。

---

## worktree を作る {#create}

git リポジトリを作業ディレクトリにしたセルのランチャに、**OR ISOLATE IN A WORKTREE** が出ます。

1. タスク名を入れます（例：`fix-login`）。
2. **New worktree** を押すと、そのタスク専用の worktree ができ、そこでセッションが起動します。

![worktree はランチャフォームから](../images/grid-launch-form.png)

既にある worktree はその下に一覧で出るので、続きはそこから開きます。

### ブランチ名と、どこから分岐するか {#branch}

| 作り方 | ブランチ名 | 分岐元 |
|---|---|---|
| ランチャでタスク名を入れる | `agent/<タスク名>` | **ローカル**のベースブランチ |
| [issue の行の ▶](github.html) から | `issue/<番号>-<slug>` | **fetch した `origin/<ベース>`** |

issue 起点だけリモートから分岐するのには理由があります。同じリポジトリのクローンを何個も並べて
いると、`pull` されるのは*いま作業しているクローンだけ*なので、ローカルから分岐すると 1 週間前の
コードの上で作業を始めてしまいます。リモートに届かないときはローカルのブランチから分岐し、
worktree の作成自体は成功します。

### どこに作られるか {#location}

作業中のリポジトリの中ではなく、MulmoTerminal の管理下に作られます。

```
~/.mulmoterminal/worktrees/<リポジトリ名>-<ハッシュ>/<ブランチ名から接頭辞を除いたもの>/
```

フォルダ名はブランチ名の**先頭のセグメントを落としたもの**です（`agent/fix-login` なら
`fix-login`、`issue/1026-fix-login` なら `1026-fix-login`）。1 階層に収めるためで、
そうしないと `worktree add` がルートの下にもう 1 段フォルダを掘ってしまいます。

環境変数 `MULMOTERMINAL_HOME` を設定すると、**この worktree のルートだけ**が動きます
（→ [設定 → 環境変数](config.html#env)）。`~/.mulmoterminal` に置かれる他のもの（レート制限の
キャッシュ、バックアップなど）は移動しません。

リポジトリの中に散らからないので、`git status` が worktree で汚れることはありません。

---

## 1 つの worktree に 1 セッション {#one-session}

worktree はブランチに紐づくので、**多重起動しません**。同じブランチを 2 体のエージェントに
渡せば、結局同じファイルを取り合うことになるからです。

一覧の各行は、状態によって意味が変わります。

| 行の表示 | 押すとどうなる |
|---|---|
| 何も出ていない | その worktree で最初のセッションを起動 |
| `resume` | その worktree が既に持っているセッションを再開 |
| `in use` | **押せません**。そのセッションは別のターミナルで開かれています（先に向こうを閉じる） |

この制限は行ではなく**ディレクトリ**に付きます。同じ worktree のパスを **WORKING DIRECTORY** に
貼っても、最近使ったディレクトリのチップから開いても起動しません。最終的に拒否するのはサーバなので、
どのクライアントから来ても、パスの書き方を変えてもすり抜けません。

**制限の対象はエージェント**（Claude / Codex / Antigravity）です。**OR LAUNCH** の起動コマンドでも、
中身がエージェントなら同じく拒否されます。**Shell** と、それ以外を走らせる launcher（`yarn dev`、
`lazygit` など）は対象外です — エージェントが作業している worktree こそ、それらを動かしたい場所なので。

しかも、プロジェクトがそう宣言していれば、その 2 つの `yarn dev` がポート 3000 を
取り合うこともありません。[`worktreeEnv`](config.html#worktree-env) に書いた変数
（ポート・DB 名、どちらか一方でも複数でも）ごとに **worktree ごとの値**が配られ、
その worktree のターミナルに環境変数として渡り、セルのヘッダに出ます（ポートは
クリックできる `:3010`）。

---

## worktree の中で作業する {#work}

### 差分バッジ {#diff-badge}

変更が溜まると、セルヘッダーに `+2 ●5` のような差分バッジが出ます。`+` がベースブランチより
進んだコミット数、`●` が未コミットの項目数（`git status --porcelain` の行数なので、
ステージ済み・未ステージ・未追跡をすべて数えます）。クリックで差分パネルが開きます。

このバッジが出るのは **worktree のセルで、かつ変更があるとき**だけです。通常のプロジェクトの
セルには出ません。

### コミット・Push・PR {#pr}

差分バッジを押して開いた**差分パネルの下辺**に、3 つのボタンが並びます。

| ボタン | すること | 押せない条件 |
|---|---|---|
| **Commit** | Claude にコミットを依頼します（自分でコミットメッセージを考えなくて済みます） | 未コミットの変更が無いとき。そのセッションが作業中のとき |
| **Push** | `git push -u origin` | コミットが 1 つも進んでいないとき |
| **Open PR** | push して、PR をブラウザで開きます | 同上 |

issue 起点の worktree ならブランチが issue 番号を持っているので、**Open PR** は PR 本文に
`Fixes #<番号>` を入れます。以降、ヘッダーの [work チップ](header-reference.html#builtin-chips)・
issue への作業コメント・マージ時の自動クローズが、すべて同じ番号を読みます。

---

## 閉じるときに片付ける {#close}

worktree のセルを閉じると、**残すか消すか**を先に聞きます。**Remove worktree** は worktree を消し、
その**ブランチも一緒に**消します（あとで `git branch -D` して回らなくて済むように）。

![worktree セルを閉じる](../images/worktree-close-keep.png)

**未コミット・未 push が残っているときは、その数を出して**ボタンが **Discard & remove** に変わります。
何が消えるかを、押す前にボタン自身が言います。差分はこの確認を出す瞬間に取り直すので（その間ボタンは
`Checking…`）、直前に生まれた変更を見落としたまま消すことはありません。

![未コミットがある worktree を閉じる](../images/worktree-close-discard.png)

消せるのは**このアプリが作った worktree だけ**です。管理下のディレクトリの外を指す削除は、
サーバが拒否します。

---

## プロジェクトの設定を引き継ぐ {#inherit}

新しい worktree には、プロジェクトの `.mulmoterminal.json` から作った**専用のコピー**が置かれます。
色も名前もモデルも引き継がれるので、worktree のセルだけ無地に見える、ということが起きません。

引き継ぎ規則の詳細（色を少しずらす理由、引き継がれないキー、書かれない 2 つのケース）は
[設定 → worktree はこのファイルを引き継ぐ](config.html#worktree-inherit)に。

> **`.gitignore` に `.mulmoterminal.json` を入れてください。** 入っていないと worktree の
> `git status` に未追跡ファイルとして出ます。これは単に汚いだけではなく、MulmoTerminal は
> **未コミットの変更がある worktree の削除を拒否する**ので、掃除できない worktree になります。

---

## 関連 {#related}

- [issue から worktree を作る](github.html) — issue の行の ▶ で、読み込み・worktree 作成・起動まで 1 クリック
- [設定 → worktree はこのファイルを引き継ぐ](config.html#worktree-inherit)
- [用語集 → git worktree](glossary.html#git-worktree)
