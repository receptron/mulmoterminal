---
title: GitHub — PR / Issue 横断ビュー
layout: default
parent: 日本語
nav_order: 7
---

# GitHub — PR / Issue 横断ビュー
{: .no_toc }

- TOC
{:toc}

**複数のリポジトリにまたがる未マージの Pull Request と Issue を、1 画面でまとめて確認できます。**
どのリポで何がレビュー待ちか、CI が落ちていないか——セッションを渡り歩かずに一望できます。
表示するリポは自分で**登録**します（`owner/repo` を並べるだけ）。

- ツールバーの **Pull requests**（`call_merge` アイコン）で開く、全画面のビュー。
- **Open な PR と Issue の両方**を、**リポジトリごと**にまとめて表示。
- データは **GitHub CLI（`gh`）** 経由。**`gh` のログインをそのまま使う**ので、アプリにトークンは保存しません。

---

## ① 見たいリポを登録する

表示されるのは**登録したリポだけ**です（worktree やセッションから自動では増えません）。
方法は 2 つ、どちらも**即反映**（再起動不要）。

### 設定モーダルから（おすすめ）

1. ツールバーの **⚙（設定）→ Pull request repos** を開きます。
2. 入力欄に **`owner/repo`**（例 `receptron/mulmoterminal`）を入れて **Add**。
3. 追加したリポは一覧に並び、各行の **✕** で削除できます。

> 形式は `owner/repo` のみ（スペース・パス・`https://…` は不可）。`gh --repo` にそのまま渡すため、
> `owner` と `repo` を `/` でつないだ素のスラッグだけが有効です。

### 設定ファイルを直接編集

`~/.mulmoterminal/config.json` の **`prRepos`**（`"owner/repo"` の配列）に書きます。

```json
{
  "prRepos": ["acme/web", "acme/api"]
}
```

→ キーの一覧は [設定方法](config.html) を参照。

## ② ビューを開いて見る

ツールバーの **Pull requests**（`call_merge`）をクリックすると、**PRs & Issues** ビューが開きます
（**Accounting** と **Wiki** の間）。

- 上に **Pull requests**、下に **Issues** の 2 セクション。どちらも **リポジトリごと**に見出し
  （`owner/repo` と件数）でまとまります。
- 表示されるのは **Open な項目だけ**。並び順は登録した順（リポ）と `gh` が返す順（項目）。
- **行をクリックすると GitHub が別タブで開きます**（アプリ内では開きません）。
- 右上の **↻（Reload）** で再取得。**自動更新はしません**——開いたときに一度取得し、あとは Reload で更新します。

### PR の行に出る情報

| 表示 | 意味 |
|---|---|
| **● CI ドット** | 緑＝Checks passing／赤＝failing／琥珀＝running／淡色＝No checks |
| **#番号・タイトル** | PR 番号とタイトル |
| **draft** | ドラフト PR のとき |
| **approved / changes requested / review required** | レビュー状態 |
| **作者 · 相対時刻** | 例 `alice · 2h ago`（最終更新） |

Issue の行は **#番号・タイトル・作者 · 相対時刻** のみ。

> 1 リポあたり **PR は最大 100 件 / Issue は最大 20 件**まで。超えると「これ以上あります」の注記と
> GitHub へのリンクが出ます。

## 前提：GitHub CLI にログインしておく

このビューは裏で **`gh` コマンド**を実行します。あらかじめサーバを動かすマシンで：

```bash
gh auth login
```

- アプリはトークンを保存・参照しません。**`gh` のログイン権限**でそのまま見えます。
- リポは**必ずサーバ側の設定**から取得します（リクエストからは受け取りません）。
- 各リポの取得は**並行**で、**失敗したリポだけ**そのエラーを表示します（他のリポは表示されます）。

## 見えないときは

- **「No repositories configured…」と出る。** → まだ登録がありません。**⚙ → Pull request repos** で `owner/repo` を追加。
- **「gh not found…」と出る。** → GitHub CLI を入れて `gh auth login`。
- **特定のリポだけエラー。** → 綴り（`owner/repo`）と、そのリポへの **`gh` のアクセス権**を確認。private なら権限が必要です。
- **さっき出した PR が出ない。** → 自動更新はないので **↻ Reload**。それでも無ければ Open 状態か、`owner/repo` が正しいか確認。
- **件数が頭打ち。** → 1 リポ PR 100 / Issue 20 の上限です。全部は各行のリンクから GitHub で。

---

← [機能一覧](features.html) ／ [設定方法](config.html) ／ [日本語ガイドの目次](index.html)
