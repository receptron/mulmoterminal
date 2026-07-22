---
title: OpenRouter で別のモデルを使う
layout: default
parent: 日本語
nav_order: 5
---

# OpenRouter で別のモデルを使う
{: .no_toc }

- TOC
{:toc}

Claude Code は **Anthropic 互換**のバックエンドなら何にでも接続できます。MulmoTerminal はその接続先を
設定ファイルから、**鍵はサーバを起動したときの環境変数から**読み、セッションごとにモデルを選べるように
します。Kimi・DeepSeek・GLM・Gemini・GPT・Grok などを、いつもの端末のまま使えます。

このページは **OpenRouter** を例に、最初の 1 回の設定から、自分でモデルを足すところまでを扱います。
Moonshot や社内の LiteLLM ゲートウェイなど、他の Anthropic 互換バックエンドでも手順は同じです。

---

## 全体像

設定は **3 か所**に分かれます。分かれている理由がそれぞれあります。

| 何を | どこに | なぜそこか |
|---|---|---|
| **接続先**（URL・鍵の変数名） | `~/.mulmoterminal/config.json` の `providers` | アプリ全体で共有するため。**組み込みの接続先は無いので、ここを書かないと何も選べません** |
| **API キー** | サーバの環境変数（`.env` など） | **この設定ファイルはブラウザとスマホに配信される**ため、鍵を書いてはいけない |
| **既定のモデル** | プロジェクトの `.mulmoterminal.json` | プロジェクトごとに変えたいため |

そのうえで、**起動時にセッション単位で選べます**（既定を書き換えません）。

---

## 1. OpenRouter のキーを取る

1. [openrouter.ai](https://openrouter.ai) でアカウントを作る
2. [Keys](https://openrouter.ai/settings/keys) で API キーを発行（`sk-or-…`）
3. クレジットを入れる（従量課金。下の表のとおり 100 万トークンあたり $0.08 のモデルもあります）

**あわせて確認**: [Privacy 設定](https://openrouter.ai/settings/privacy)。ここが厳しいと、一部のモデルで
配信元が全部除外され `404 No endpoints available` になります。下の表で「到達不可」と書いてあるものは
これに当たったもので、**モデルの欠陥ではありません**。

---

## 2. 接続先を登録する（**必須**）

**この登録が無いと、モデル選択欄はそもそも出ません。** 組み込みの接続先は 1 つもありません。

検証済みの 27 モデルはアプリに入っていますが、そこにあるのは**モデルの id と実測値だけ**です。
**どこに繋ぐか（`baseUrl`）と、鍵をどの環境変数から読むか（`tokenEnv`）は入っていない**ため、
登録するまで送信先が決まりません。実測すると差はこうなります。

| `providers` | 選べるモデル | MODEL 選択欄 |
|---|---|---|
| 未設定（初期状態） | **0 件** | 出ない |
| 登録済み | **27 件** | 出る |

### 一発で追加する
{: .no_toc }

既存の設定を壊さずに追加します（`config.json.bak` にバックアップを取り、二重実行しても重複しません）。

```bash
node -e '
const fs = require("fs"), os = require("os"), path = require("path");
const file = path.join(os.homedir(), ".mulmoterminal", "config.json");
const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
if (fs.existsSync(file)) fs.copyFileSync(file, file + ".bak");
config.providers = [
  ...(config.providers ?? []).filter((p) => p.id !== "openrouter"),
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api", tokenEnv: "OPENROUTER_API_KEY", maxOutputTokens: 16000 },
];
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
console.log("added openrouter to " + file);
'
```

### 手で書く
{: .no_toc }

`~/.mulmoterminal/config.json` が**まだ無い**なら、これをそのまま貼れば完成です。

```json
{
  "providers": [
    {
      "id": "openrouter",
      "label": "OpenRouter",
      "baseUrl": "https://openrouter.ai/api",
      "tokenEnv": "OPENROUTER_API_KEY",
      "maxOutputTokens": 16000
    }
  ]
}
```

**すでにファイルがある場合は、上書きせず `providers` の行だけを既存の `{ … }` の中に足してください。**
丸ごと置き換えると `cwdPresets` やヘッダーのボタン設定が消えます。

```json
{
  "cwdPresets": [ ... 既存のまま ... ],
  "chips": [ ... 既存のまま ... ],

  "providers": [
    {
      "id": "openrouter",
      "label": "OpenRouter",
      "baseUrl": "https://openrouter.ai/api",
      "tokenEnv": "OPENROUTER_API_KEY",
      "maxOutputTokens": 16000
    }
  ]
}
```

### LLM に頼む
{: .no_toc }

どのディレクトリでもいいので、Claude のセッションに `mulmoterminal の設定に OpenRouter を追加して` と
頼めば、同梱の `mulmoterminal-config` スキルが既存の設定を保ったまま書いてくれます（**鍵は書きません**）。

**モデルは書きません。** この `id` のプロバイダを登録した時点で、[検証済みの 27 モデル](#verified)が
選択肢に出ます。書くのは、その一覧に**無いモデルを足したいとき**だけです（→ [モデルを足す](#add-models)）。

| キー | 意味 |
|---|---|
| `id` | 他の設定から参照する名前。英数と `. _ : / - ~` のみ |
| `label` | 選択画面に出る表示名 |
| `baseUrl` | **末尾に `/v1` を付けない**（下の注意を参照） |
| `tokenEnv` | 鍵が入っている環境変数の**名前**。鍵そのものではありません |
| `maxOutputTokens` | 任意。省略時 16000 |
| `models` | 任意。組み込み一覧に**無い**モデルを足すときだけ（→ [モデルを足す](#add-models)） |

### `baseUrl` に `/v1` を付けてはいけない
{: .no_toc }

Claude Code は自分で `/v1/messages` を付け足します。`https://openrouter.ai/api/v1` と書くと
`…/v1/v1/messages` になって全リクエストが 404 します。MulmoTerminal はこれを起動前に弾き、理由を表示します。

### `maxOutputTokens` を削らない
{: .no_toc }

思考型モデルは出力枠が足りないと**考えるだけで枠を使い切り、本文が空**で返ってきます。画面上は
「固まった」ようにしか見えないので、16000 以上を維持してください。

---

## 3. キーをサーバの環境変数に置く

MulmoTerminal を起動するシェル、またはその隣に置いた `.env` に書きます。

```bash
OPENROUTER_API_KEY=sk-or-…
```

**設定ファイルには絶対に書かないでください。** `config.json` は `GET /api/config` でブラウザとスマホに
配信されます。`tokenEnv` が「変数の名前」なのはこのためです。

書いたら**サーバを再起動**します（環境変数は起動時に読まれます）。

鍵が見つからないプロバイダは、**セッションの起動を拒否します**。黙って Anthropic に落とすと、
そのディレクトリが選んでいないバックエンドにプロンプトが流れてしまうためです。

---

## 4. 使う

### 起動時に選ぶ

プロバイダが 1 つでも使える状態になると、空セルの起動フォームに **MODEL** の選択欄が出ます。

- 選んだ内容は**そのセッションだけ**に効きます
- `.mulmoterminal.json` の既定は書き換わりません
- 何も選ばなければ既定のままです

セッションが動き出すと、**ヘッダー 1 行目のバッジ**に実行中のモデルとコンテキスト使用率が出ます
（例: `Kimi K2.7 Code · ctx 12%`）。出ていない場合は、設定の `chips` に `ctx` が含まれているか確認してください。

### プロジェクトの既定にする

そのディレクトリの `.mulmoterminal.json`:

```json
{
  "provider": "openrouter",
  "model": "moonshotai/kimi-k2.7-code"
}
```

`provider` を省いて `model` だけ書くと、**Anthropic のまま**別のモデルを指定できます。

id に使えるのは英数と `. _ : / - ~` だけです（`providers` の `id` と同じ規則。OpenRouter の
`~anthropic/claude-opus-latest` のような「常に最新」エイリアスも使えます）。空白や先頭のダッシュなど
形が違う値を書くと、そのディレクトリのセッションは**起動を拒否します** — 黙って別のモデルで動き出す方が
危険なためです。色やテーマなど他の設定はそのまま読み込まれます。

### 再開したときの挙動
{: .no_toc }

- **起動時に選んだモデル**は、そのセッションを再開しても維持されます（サーバが動いている間）
- **`.mulmoterminal.json` の既定**は他の設定と同じく即反映で、書き換えれば次回起動から効きます

---

## 5. モデルを足す {#add-models}

組み込みのプリセット（下の表）に無いモデルも使えます。

### 設定に書く
{: .no_toc }

```json
{
  "providers": [
    {
      "id": "openrouter",
      "label": "OpenRouter",
      "baseUrl": "https://openrouter.ai/api",
      "tokenEnv": "OPENROUTER_API_KEY",
      "models": ["qwen/qwen3-coder", "inception/mercury-coder"]
    }
  ]
}
```

選択欄に **`未計測`** と添えて並びます。私たちが動作を確認していないという意味です。

モデル id は [openrouter.ai/models](https://openrouter.ai/models) の各ページに出ている
`ベンダー/モデル名` の文字列をそのまま使います。

### LLM に設定してもらう
{: .no_toc }

JSON を手で編集したくない場合、どのディレクトリでもいいので Claude のセッションに頼めます。

> mulmoterminal の設定に OpenRouter を追加して

同梱の `mulmoterminal-config` スキルがこのファイルの構造と検証済みモデル一覧を知っているので、
安全な形で書いてくれます（**鍵は書き込みません**）。

### 動くかどうか自分で測る
{: .no_toc }

**プロンプトに答えられることと、Claude Code を動かせることは別です。** 実際に、流暢に返事をしながら
一度もツールを呼ばないモデルがありました（`Read(file_path=…)` を文章として出力してしまう）。

そこで、本番と同じ起動経路で「**ファイルを読んで、別のファイルに書く**」——会話だけでは絶対に達成できない
課題——をやらせて数えるスクリプトを同梱しています。

```bash
yarn tsx scripts/model-trials.ts --provider openrouter --trials 3 qwen/qwen3-coder
```

```
3/3    16s    qwen/qwen3-coder
```

試行間で成功と失敗を行き来するモデルが実在したため、**1 回の判定ではなく比率**で記録します。
組み込みプリセットの数字（`common/modelPresets.ts`）もこれで測ったものです。

---

## 検証済みモデル一覧 {#verified}

2026-07-22 時点、1 つの OpenRouter アカウントでの実測値です。**通過**は上のツール課題を完走した回数、
**中央値**は成功した試行の所要時間。価格は 100 万トークンあたりの入力 / 出力。

| モデル id | 表示名 | 通過 | 中央値 | コンテキスト | 価格 (in/out) |
|---|---|---|---|---|---|
| `nvidia/nemotron-3-super-120b-a12b` | Nemotron 3 Super 120B | 3/3 | 18s | 1M | $0.08 / $0.45 |
| `qwen/qwen3-235b-a22b-2507` | Qwen3 235B A22B | 3/3 | 16s | 262k | $0.09 / $0.55 |
| `minimax/minimax-m2.7` | MiniMax M2.7 | 3/3 | 16s | 205k | $0.25 / $1 |
| `deepseek/deepseek-v3.2` | DeepSeek V3.2 | 3/3 | 42s | 164k | $0.269 / $0.4 |
| `minimax/minimax-m3` | MiniMax M3 | 3/3 | 14s | 1M | $0.3 / $1.2 |
| `deepseek/deepseek-v4-pro` | DeepSeek V4 Pro | 3/3 | 20s | 1M | $0.435 / $0.87 |
| `deepseek/deepseek-v4-flash` | DeepSeek V4 Flash | 3/4 | 26s | 1M | $0.094 / $0.188 |
| `openai/gpt-oss-120b` | GPT-OSS 120B | 3/4 | 18s | 131k | $0.037 / $0.17 |
| `moonshotai/kimi-k2-0905` | Kimi K2 0905 | 3/3 | 18s | 262k | $0.6 / $2.5 |
| `moonshotai/kimi-k2-thinking` | Kimi K2 Thinking | 3/3 | 20s | 262k | $0.6 / $2.5 |
| `moonshotai/kimi-k2.6` | Kimi K2.6 | 3/3 | 46s | 262k | $0.684 / $3.42 |
| `z-ai/glm-5.2` | GLM 5.2 | 3/3 | 21s | 1M | $0.819 / $2.574 |
| `moonshotai/kimi-k2.7-code` | Kimi K2.7 Code | 3/3 | 14s | 262k | $0.82 / $3.75 |
| `moonshotai/kimi-k3` | Kimi K3 | 3/3 | 29s | 1M | $3 / $15 |
| `tencent/hy3` | Tencent Hy3 | 3/3 | 17s | 262k | $0.14 / $0.58 |
| `nvidia/nemotron-3-ultra-550b-a55b` | Nemotron 3 Ultra 550B | 3/3 | 13s | 512k | $0.6 / $3.6 |
| `google/gemini-3.5-flash-lite` | Gemini 3.5 Flash-Lite | 3/3 | 11s | 1M | $0.3 / $2.5 |
| `amazon/nova-2-lite-v1` | Nova 2 Lite | 2/3 | 20s | 1M | $0.3 / $2.5 |
| `openai/gpt-5.6-luna` | GPT-5.6 Luna | 3/3 | 27s | 1M | $1 / $6 |
| `openai/gpt-5.6-luna-pro` | GPT-5.6 Luna Pro | 3/3 | 69s | 1M | $1 / $6 |
| `google/gemini-3.6-flash` | Gemini 3.6 Flash | 3/3 | 16s | 1M | $1.5 / $7.5 |
| `x-ai/grok-4.5` | Grok 4.5 | 3/3 | 13s | 500k | $2 / $6 |
| `openai/gpt-5.6-terra-pro` | GPT-5.6 Terra Pro | 3/3 | 38s | 1M | $2.5 / $15 |
| `meta-llama/llama-4-maverick` | Llama 4 Maverick | **0/4** | — | 1M | $0.2 / $0.8 |
| `qwen/qwen3.7-plus` | Qwen3.7 Plus | 到達不可 ※ | — | 1M | $0.32 / $1.28 |
| `mistralai/mistral-medium-3-5` | Mistral Medium 3.5 | 到達不可 ※ | — | 262k | $1.5 / $7.5 |
| `mistralai/devstral-2512` | Devstral 2512 | 到達不可 ※ | — | 262k | $0.4 / $2 |

※ **到達不可** … 計測に使ったアカウントの [Privacy 設定](https://openrouter.ai/settings/privacy)で
配信元が全部除外されていたもの。**モデルの欠陥ではなく**、設定次第で動く可能性があります。

**`meta-llama/llama-4-maverick` は 4 回とも 0 回**でした。接続はできて返事も返るのに、ツールを一度も
呼びません。一覧から消さずに残しているのは、「あれは使えるの？」に**沈黙ではなく計測で答える**ためです。

迷ったら **Kimi K2.7 Code**（速い・コーディング向き）か **Nemotron 3 Super 120B**（安い）あたりから
試すとよいです。

---

## うまくいかないとき

| 症状 | 原因と対処 |
|---|---|
| 起動時に「`OPENROUTER_API_KEY` が要る」と出て始まらない | 鍵がサーバの環境変数に無い。`.env` に書いてサーバを再起動 |
| 全リクエストが 404 | `baseUrl` の末尾に `/v1` が付いている |
| `404 No endpoints available …` | そのモデルが [Privacy 設定](https://openrouter.ai/settings/privacy)で除外されている |
| 返事が空、固まったように見える | `maxOutputTokens` が小さすぎる。16000 以上に |
| ツールを使わず、文章だけ返ってくる | そのモデルの限界。上の一覧か `model-trials.ts` で確認を |
| モデル選択欄が出ない | `providers` が未登録（[2 章](#2-接続先を登録する必須)）か、鍵が無い。フォームの「Use another model…」から不足箇所を確認できます |
| ヘッダーにモデル名が出ない | 設定の `chips` に `ctx` が入っていない |
| Docker サンドボックスで起動できない | **併用できません**。コンテナは環境変数を引き継がず、そのままだと選んだはずのプロバイダではなく Anthropic に接続してしまうため、明示的に拒否しています |

---

## 安全面のまとめ

- 鍵は**設定ファイルに保存されません**。環境変数の名前だけが保存されます
- セッションに渡す鍵は、コマンドライン引数ではなく**パーミッション 0600 のファイル**経由で渡されます（`ps` で他ユーザーに見えないため）
- 鍵が解決できないときは**起動を拒否**します。意図しないバックエンドにプロンプトが流れないためです
- プロバイダを使うセッションでは `ANTHROPIC_API_KEY` を子プロセスから**取り除きます**（残っていると認証トークンより優先されてしまうため）

---

← [設定方法に戻る](config.html) ／ [日本語ガイドの目次](index.html)
