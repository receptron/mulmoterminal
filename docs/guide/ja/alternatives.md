---
title: Claude Code を並列で動かすツールの比較（他の選択肢も含めて）
nav_title: 他の選択肢との比較
layout: default
parent: 日本語
nav_order: 18
description: Claude Code / Codex を複数同時に走らせるツール — T3 Code、Vibe Kanban、Nimbalyst、Parallel Code、Conductor、Claude Squad、Codealong、そして Claude Code 本体の claude agents。どれがどの困りごとに向くかを、作っている側から正直に書きます。
---

# Claude Code を並列で動かすツールの比較
{: .no_toc }

**断っておくと、私はこのページに出てくる MulmoTerminal を作っている側**です。中立ではありません。
その代わり、**他のツールが優れている点**と、**自分が試していないこと**をはっきり書きます。

<details open markdown="block">
  <summary>目次</summary>
  {: .text-delta }
- TOC
{:toc}
</details>

---

## その前に、いま持っているもので足りるかもしれません

**`claude agents`** は Claude Code の **2.1.139** から入っています（Research Preview）。
知らない人が多いのですが、打つだけです。

```bash
claude agents
```

**バックグラウンドのセッション**を Working / Needs input / Completed に分けて一覧し、
それぞれ1行の要約を出します（対話中のセッションは、バックグラウンドに送ると現れます）。

**`claude --worktree <名前>`** も **2.1.49** からあります。worktree を切ってセッションを起動し、
後片付けまでやります。

**これで足りるなら、それで終わりです。** 何も入れる必要がなく、作っているのはエージェント本体の
チームです。以下は「足りなかったとき」の話です。

---

## 困りごとは5つのどれか

どのツールも「並列で動かす」はできます。違うのは**どこが痛いか**です。

| 困っていること | 向いている形 |
|---|---|
| **読めない** — 4000字の返答が画面の6分の1に入らない | **複数のライブ画面を同時に** |
| **レビューできない** — ブランチが5本上がってきて判断がつかない | **diff 中心・worktree ごと** |
| **見失う** — そもそも何を頼んだか分からなくなる | **ボードやタスクグラフ** |
| **隔離できない** — 権限を切ったエージェントを本番マシンで走らせたくない | **コンテナ**（worktree では足りない） |
| **届かない** — 走っているのは、いま自分が座っていないマシン | **中継とスマホの専用アプリ**（ポートを開けるだけでは足りない） |

**機能の数ではなく、ここで選んでください。**

---

## それぞれのツール

数字は 2026-08-03 時点（T3 Code と Vibe Kanban だけ 2026-11-08 に取り直し）。
**この分野は1年で入れ替わります** — Crystal は Nimbalyst に改称し、
Terragon は終了、Vibe Kanban の運営会社（Bloop）も 2026年4月に事業を畳みました
（プロジェクトはコミュニティ運営として継続）。

### T3 Code（★約50,000・MIT・デスクトップ + スマホ専用アプリ + ホスト版）

**このページで圧倒的に最大手**で、大きいものの中ではいちばん若いです。リポジトリができたのは
2026年2月で、いまは数時間おきに新しい版が出ています。デスクトップアプリ（Electron）、
**iOS と Android のネイティブアプリ**、それに `app.t3.codes` のホスト版があります。
ホスト版は**向こうが運用している中継**を通って手元のマシンに届くので、
スマホからエージェントに触るのに**こちら側のネットワークの用意が要りません**。
Claude Code / Codex / Cursor / Grok Build / OpenCode / Antigravity / fx 対応。

形は**スレッドの一覧で、開くのは1つずつ**。端末は主役ではなく、横に出る1枚の面です。
来客用リンク（試験中）を渡すと、口座を持たない人がブラウザで1つのスレッドを追って質問できます。
無料の枠は3台までで、それ以上は T3 Chat の有料プランが要ります。

**こちらとの違いは中身の作りのほうで、向こうの FAQ がこちらより上手く書いています。**

> Claude Code is kind of a harness. It is an interface (the TUI, the Code tab in the desktop app)
> plus a harness underneath (the Anthropic Agent SDK) … T3 Code uses those harnesses. It is not a
> harness, and it does not work without one.

つまり**エージェントを動かす土台を直に呼び、画面は自分のものに差し替える**という作りです。
MulmoTerminal は画面のほうを残します —— `claude` の CLI そのものを本物の擬似端末の中で動かします。
もう一方の経路の副作用は、同じ FAQ に書かれています ——
"all Agent SDK usage will drain your 5h limits faster than using Claude Code directly"
（5時間の上限が、Claude Code を直接使うより早く減る）。
向こうはこれを設計上の選択ではなく**上流の不具合として報告中**としています。週の上限には影響しません。

**ネイティブのスマホアプリが欲しい・中継を自分で運用したくない・OpenCode を使う**なら、
こちらよりそちらです。

### Vibe Kanban（★約28,600・Apache-2.0）

**カンバン型では最大手。** セッションではなく**タスクをカンバンでモデル化**します。
「何を頼んだか分からなくなる」が主な困りごとなら、この抽象が正しい。モバイルブラウザでも使えます。

運営会社が畳んだあとコミュニティ運営です。**半年後に issue に誰が答えるか**を気にするなら、
知っておくべき事実です。

### Nimbalyst（★1,379・MIT・macOS / Windows / Linux）

旧 Crystal。**エージェントの成果物を編集する**ことを中心に置いたデスクトップアプリ
（markdown・モックアップ・図）。タスク管理、git 管理、worktree も。

**iOS と Android のネイティブアプリ**があります。Web ページではなく本物のスマホアプリが欲しいなら
ここです。Claude Code / Codex / **OpenCode** 対応。

### Parallel Code（★716・MIT・macOS / Linux）

**Super Productivity のメンテナが単独開発。** エージェントごとに worktree とブランチを与え、
**diff をレビューしてマージする**ところを中心に設計されています。
Claude Code / Codex / **Gemini** 対応。

**出てきたものを判断するのが大変**なら、こちらの形のほうが合います。

### Conductor（macOS のみ・プロプライエタリ）

worktree 隔離と、作り込まれた diff レビュー。**Windows と Linux では使えません。**

### Claude Squad（TUI・tmux + worktree）

エージェントを tmux セッションとして管理します。**GUI があるどれよりも軽い**ので、
ターミナルから出たくない人や SSH 越しに使う人はこちらです。見えるのは1つずつ。

### Codealong（Apache-2.0・macOS / Linux は X11）

**ここだけ形ではなく層が違います。** 各エージェントがもともと書いている記録を読むので、
自分が立てていないセッションも見えます。ターミナルのもの、tmux の中のもの、Claude アプリや
Codex アプリのもの、別アカウントのもの、繋いだ別のマシンのものまで、プロジェクト・リポジトリ・
worktree・ブランチ・プルリクエストの形で1枚のボードに並びます。コマンドの許可や質問への返事も、
そのセッションを探しに行かずにそこから返せます。Claude Code / Codex / OpenCode / Antigravity /
Cursor 対応。

立てることもできて、立てたものはこちらのターミナルやエージェント自身のアプリで動きます
（頼めば Codealong 自身の画面でも動きます。Agent Client Protocol 経由）。やらないのは隔離のほうで、
worktree を作るのはエージェント側、git は基本的に読むだけです。
**どれかの代わりではなく、選んだツールの隣に置く形**です。最初のリリースは 2026-10-20 で、
できたばかりです。この節だけは 2026-10-21 時点の確認です（他は 2026-08-03 時点）。

### MulmoTerminal（MIT・ブラウザ）

こちらです。**複数のライブ端末を同時に**並べ、状態を色で示し、待っているセッションがあれば
音とスマホ通知で呼びます。セッションは tmux の中で動くので、タブを閉じてもサーバを再起動しても
消えません。Claude Code / Codex / Antigravity / Grok / Muse / GitHub Copilot CLI / Cursor CLI 対応。

**賭けているのは「要約しない」ほう**です。1行の要約は分類には効きますが、
**5体が走っている横で長い返答を読む**役には立ちません。

**やらないこと**: コンテナ隔離なし（Docker サンドボックスは 4.0.0 で削除、worktree のみ）、
ネイティブアプリなし、Gemini と OpenCode 非対応。

機械可読な仕様: [`facts.json`](https://receptron.github.io/mulmoterminal/facts.json)

---

## 一覧

| | UI | ライセンス | エージェント | モバイル |
|---|---|---|---|---|
| **T3 Code** | デスクトップ + Web | MIT | Claude / Codex / Cursor / Grok Build / OpenCode / Antigravity / fx | **iOS + Android ネイティブ**・中継つき |
| **Vibe Kanban** | Web | Apache-2.0 | 多数 | ブラウザ |
| **Nimbalyst** | デスクトップ | MIT | Claude / Codex / OpenCode | **iOS + Android ネイティブ** |
| **Parallel Code** | デスクトップ | MIT | Claude / Codex / **Gemini** | — |
| **Conductor** | デスクトップ（Mac） | プロプライエタリ | Claude / Codex / Cursor | — |
| **Claude Squad** | TUI | OSS | Claude / Codex / OpenCode / Amp | — |
| **`claude agents`** | TUI | 本体 | Claude | — |
| **Codealong** | デスクトップ | Apache-2.0 | Claude / Codex / OpenCode / Antigravity / Cursor | iPhone 版は初期段階 |
| **MulmoTerminal** | **ブラウザ** | MIT | Claude / Codex / Antigravity / Grok / Muse / Copilot / Cursor | Web + push |

**同じところに注目してください。** ほぼ全部が OSS で、worktree ベースで、ローカルで動きます。
**「MIT だから」「ローカルだから」は差別化ではなく、この分野の最低ラインです。**

**そして、どれもやっていないこと**: エージェントごとのコンテナ隔離。
権限を切ったエージェントを本番マシンで動かすのが不安なら、**どれを選んでも解決しません**。
devcontainer か VM を下に敷いてください。

---

## 選び方

- **ターミナルから出たくない** → Claude Squad、または `claude agents`
- **本物のスマホアプリが欲しい** → T3 Code、または Nimbalyst
- **走らせているマシンの前にほとんど座っていない** → T3 Code（中継があるので、
  こちらでポートを開けたり経路を掘ったりしなくて済みます）
- **主に diff を判断したい** → Parallel Code、Mac なら Conductor
- **タスク自体を見失う** → Vibe Kanban
- **セッションが道具やアカウントやマシンに散らばって、まず在処を知りたい** → Codealong（どれかの隣に置く）
- **走っているものを同時に見たい・ネットワーク越しにどの端末からでも** → MulmoTerminal

どれも1分で入ります。**6つ読むより、2つ試すほうが早いです。**

---

## 試していないこと

MulmoTerminal は毎日使っています。**他のツールはソースとドキュメントを読んだだけ**で、
継続的に使ってはいません。上の記述は各プロジェクトの README とドキュメントに基づくもので、
自分の使用経験ではありません。**誤りがあれば
[教えてください](https://github.com/receptron/mulmoterminal/issues)。** 直します。
Codealong がこのページに載っているのも、作者本人がそうしてくれたからです。

---

← [日本語ガイド index](index.html)
