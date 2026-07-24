---
title: Home
layout: default
nav_order: 1
---

# MulmoTerminal Guide

**AI と一緒にコーディング（vibe coding）してて、こんなこと、ありませんか？**

- 📊 どれが何をしているのか、**状態が分からなくなる**
- 📁 **どのディレクトリ**で動いているのか見失う
- 💭 dir は分かっても、**そもそも何を頼んだんだっけ？**（元の指示を忘れる）
- 🔔 エージェントが**終わったのに気づかず**、待たせる／待ちぼうける
- 💥 ターミナルを閉じた・落ちた瞬間に**セッションが消える**
- 🌿 git の状態を見たい・フォルダを開きたいのに、**いちいちコマンドを打つ**
- ⚡ 結局、**ターミナルを軸にサクサク作業したい**だけなのに——

**MulmoTerminal は、この一つひとつに答えます。** 複数の AI コーディングエージェント
（[Claude Code](https://claude.com/claude-code) / **Codex**）を**並行して回し**、状態と所在を**常に見える化**し、
完了を**通知**し、セッションを**落とさず**、git や dir を**ワンクリック**で開ける——**ターミナルを基軸にした現代の開発環境**です。

**Opening too many terminals and losing the thread?** — *which one is doing what*, *which directory*, *what did I even ask it*,
*is it done yet*, *my session vanished when the tab closed*, *typing `git status` / `cd` over and over*. MulmoTerminal answers
each of these: run many AI agents in parallel, always **see** their status and location, get **notified** on completion, **never
lose a session**, and open git/dirs in **one click** — a **terminal-first modern development environment**.

![A board of parallel AI-agent terminals](guide/images/grid-2x2.png)

## ✨ おすすめ機能 / Highlights

**📋 コックピット・ロスター / The cockpit roster** — 1 体に拡大したまま、横の一覧で全セッションの
**AI 要約・直近の指示・最新の返答・PR フェーズ**（CI fail / ready / merged …）を 1 行ずつ追えます。
Stay zoomed into one agent while a text list tracks every session's **AI summary, last prompt,
latest reply, and PR phase** — the main screen for running many agents.
→ [基本編](guide/ja/basics.html) / [Basics](guide/en/basics.html)

![コックピット・ロスター / The cockpit roster](guide/images/cockpit-roster.png)

**📱 スマホ通知 & リモコン / Phone push & remote control** — タスクの完了・入力待ちを**スマホへ
Web Push**。そのままライブ画面を見て **yes / no / continue** をワンタップで返せます。
Finished / input-waiting turns push to your phone — glance at the live screen and answer with a tap.
→ [設定手順](guide/ja/notifications.html) / [Setup](guide/en/notifications.html)

![スマホのロック画面に届いた通知 / Push notifications on the lock screen](guide/images/push-lock-screen.jpg)

**🌿 worktree 隔離 & ワンクリック PR / Worktrees & one-click PRs** — 同じリポに複数エージェントを
衝突なしで走らせ、diff・コミット・Push・**⧉ Open PR** までセルの中から。
Several agents on one repo without collisions — diff, commit, push, and **⧉ Open PR** from the cell.

## こんなとき → MulmoTerminal / Sound familiar? → Handled

| こんなとき | MulmoTerminal では |
|---|---|
| 複数ターミナルの**状態**が分からない | グリッドに並べ、**状態の色**（作業中＝青／入力待ち＝琥珀／完了・レビュー待ち＝青リング）＋通知音で一目 |
| **どのディレクトリ**か分からない | 各セルに dir・**プロジェクト名バッジ・色**。色分けで即区別 |
| **元の指示**を忘れる | セルヘッダーに**直近の指示／今やっていること**を常時表示、🕘 で**ツール履歴** |
| **完了**に気づきたい | 入力待ちは**琥珀色**、完了は**青リング**、どちらも**通知音**——さらに**スマホへ Web Push** |
| **セッションを継続**したい | **tmux 永続化**で、リロード・再接続・サーバ再起動を跨いで生き続ける |
| **git / dir をサッと**開きたい | git ステータスチップ、ワンクリックで **OSのファイルマネージャ(Finder/Explorer等) / アプリ内ファイル / PR** |
| **ターミナル基軸**で効率化 | 上記すべてを端末の上に載せ、**DSL で自分のワークフローに拡張** |

## 4 本柱 / Four pillars

**監督 (Supervise)** 並行エージェントのコックピット · **可視化 (See)** 状態と所在を一目 ·
**自動化 & 調査 (Automate & investigate)** 実行と AI 診断 · **拡張 (Extend)** DSL でどんな開発者にも。

## 🚀 起動 / Quick start

**必要なもの:** [`claude`](https://claude.com/claude-code) CLI（Claude Code）が PATH にあること + **Node ≥ 22.9**。
Claude Code が動く環境なら、あとはコマンド 1 つ。
**あると便利:** `tmux`（セッション永続化）· `gh`（PR/Issue ビュー）· `codex`（Codex セッション）。

```bash
npx mulmoterminal@latest                       # → http://localhost:34567 が開く
npx mulmoterminal@latest --cwd ./my-project    # 作業ディレクトリを指定（--port <n> も可）
```

**Prerequisites:** the [`claude`](https://claude.com/claude-code) CLI on your PATH + **Node ≥ 22.9** — if Claude Code
runs, you're ready. **Recommended:** `tmux` (session persistence) · `gh` (PRs/Issues) · `codex` (Codex sessions).

```bash
npx mulmoterminal@latest                        # opens http://localhost:34567
```

---

## 日本語

- [はじめに（あるある & コンセプト）](guide/ja/)
- [基本編 — グリッドで今できること](guide/ja/basics.html)
- [応用編 — シナリオ別の使い方](guide/ja/scenarios.html)
- [機能一覧](guide/ja/features.html)
- [設定方法](guide/ja/config.html)
- [スマホ通知（Web Push）](guide/ja/notifications.html)
- [OpenRouter で別のモデルを使う](guide/ja/providers.html)
- [claude-ollama でローカルモデル](guide/ja/claude-ollama.html)

## English

- [Introduction (sound familiar? & the concept)](guide/en/)
- [Basics — what you can do in the grid](guide/en/basics.html)
- [Scenarios — workflows by example](guide/en/scenarios.html)
- [Feature reference](guide/en/features.html)
- [Configuration](guide/en/config.html)
- [Mobile notifications (Web Push)](guide/en/notifications.html)
- [Using another model via OpenRouter](guide/en/providers.html)
- [Local models with claude-ollama](guide/en/claude-ollama.html)

---

> Repo: [github.com/receptron/mulmoterminal](https://github.com/receptron/mulmoterminal) ·
> npm: [`mulmoterminal`](https://www.npmjs.com/package/mulmoterminal) — `npx mulmoterminal@latest`
