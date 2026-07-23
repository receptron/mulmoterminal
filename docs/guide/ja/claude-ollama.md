---
title: claude-ollama でローカルモデルを動かす
layout: default
parent: 日本語
nav_order: 6
---

# claude-ollama でローカルモデルを動かす
{: .no_toc }

`claude-ollama` は、**クラウドを一切使わず、手元の [Ollama](https://ollama.com) モデルで Claude Code を動かす**ための一発起動コマンドです。API キー不要・オフライン可。

> これは MulmoTerminal の Web UI ではなく、**素の `claude`（Claude Code CLI）を Ollama に向けて起動する**スタンドアロンのラッパーです（mulmoterminal パッケージに同梱）。

## 前提

- [Ollama](https://ollama.com/download) が入っていること（**サーバ 0.31 以上**。Anthropic 互換の `/v1/messages` が必要。`ollama --version` ではなく、動いているサーバの版が `curl http://localhost:11434/api/version` で 0.31+ か）
- Claude Code（`claude`）が入っていること（`npm install -g @anthropic-ai/claude-code`）
- 使うモデルを pull 済みであること（`ollama pull qwen3:4b`）

## 使い方

```bash
# npx（インストール不要）
npx -p mulmoterminal claude-ollama qwen3:4b

# または mulmoterminal をグローバル導入して
npm install -g mulmoterminal
claude-ollama qwen3:4b

# claude への引数はそのまま後ろに渡せる
claude-ollama qwen3:30b-a3b "このモジュールをリファクタして"
```

## 何をしているか（3点セット）

Ollama 0.31+ は Anthropic 互換の `/v1/messages` を持つので、`ANTHROPIC_BASE_URL` を向けるだけで変換層なしに繋がります。ただし**小型ローカルモデルをまともに動かすには次の3点が要り、`claude-ollama` がこれを自動で仕込みます**:

1. **大きい context** — 専用ポートで `OLLAMA_CONTEXT_LENGTH=32768` の `ollama serve` を起動します。既定の 4096 では Claude のシステムプロンプトが溢れ、2ターン目でセッションが落ちます。**すでに動いている Ollama（11434）は触りません**。終了時に自動で止めます。
2. **システムプロンプトの最小化** — `claude --bare --disable-slash-commands` を付与し、skills / plugins / MCP / hooks を落とします。これでプロンプトが **約 16000 → 約 400 トークン**に激減します。**これが無いと小型モデルはツールを使わず一般応答してしまいます**（動かない一番の原因）。
3. **環境変数** — `ANTHROPIC_API_KEY` を外し（残っていると base URL より優先される）、`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN=ollama` / `ANTHROPIC_MODEL` / `ANTHROPIC_SMALL_FAST_MODEL`（＝同じモデル）/ `CLAUDE_CODE_MAX_OUTPUT_TOKENS=8000` を設定します。

## モデルの選び方

- **`qwen3:4b`（軽量）/ `qwen3:30b-a3b`** はツールを使うマルチターン（ファイル作成→読み戻し等）の完走を確認済み。
- **`llama3.1:8b` は不可** — 単発のツール呼び出しは返すが、マルチターンの tool-result ターンで壊れる（Ollama のチャットテンプレートが `assistant\n\n` を漏らす）。
- **必ず実際のマルチターン実行で確かめること**。単発の疎通確認だけでは判断できません。

## 注意点

- **速度はモデル / マシン依存**。qwen3:4b でも、ツールを使うターンは負荷次第で数十秒〜数分かかることがあります（完走はします）。
- 毎回専用サーバを立てるため、モデルの**初回ロード**が入ります（初回ターンが遅い）。その代わり context が確実に大きい。

---

← [OpenRouter で別のモデルを使う](providers.html) ／ [日本語ガイドの目次](index.html)
