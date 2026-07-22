# feat #579 — モデル指定と Anthropic 互換プロバイダでのセッション起動

## スコープ（この PR）

セッションを **ディレクトリ単位で** 別モデル・別プロバイダに向けられるようにする。設定は既存の
`.mulmoterminal.json`（per-dir）＋グローバル config で完結し、**新しい UI は作らない**。

UI（起動フォームでのプロバイダ/モデル選択）は後続 PR。

## なぜ per-dir 設定か

`spawnClaudePty` は既に引数 7 個で lint の上限（6）を超えている。引数を増やすのではなく、
**すでに渡っている `cwd` から `loadDirConfig(cwd)` で引く**。per-dir の色・テーマ・スキルと
同じ仕組みに乗るだけで済み、新しい配線が要らない。

## 設定の形

```jsonc
// ~/.mulmoterminal/config.json — 鍵の実体は書かない
{
  "providers": [{
    "id": "openrouter",
    "label": "OpenRouter",
    "baseUrl": "https://openrouter.ai/api",   // CC が /v1/messages を付けるので付けない
    "tokenEnv": "OPENROUTER_API_KEY",          // 名前だけ。実体はサーバの env / .env
    "maxOutputTokens": 16000                   // 省略時 16000（thinking モデル対策）
  }]
}
```

```jsonc
// <dir>/.mulmoterminal.json
{ "provider": "openrouter", "model": "z-ai/glm-5.2" }
```

`provider` を省いて `model` だけなら、Anthropic 本家のまま `--model` を渡す。

## 実装

### 1. `server/session/provider-env.ts`（新規・純粋関数）

この機能の判断を全部ここに集める。起動しないとテストできない場所にロジックを置かない。

```ts
export interface ProviderResolution {
  model: string | null;          // --model に渡す値
  env: Record<string, string>;   // settings の env ブロックに載せる
  unset: string[];               // 子プロセスの env から取り除く名前
}
export type ProviderResult =
  | { ok: true; value: ProviderResolution }
  | { ok: false; reason: string };
```

規則（すべて #579 の実測に基づく）:

- **`baseUrl` とトークンは常にペア**。`tokenEnv` が解決できなければ `ok: false` で**起動を拒否**する。
  黙って fallback すると、認証優先順位の最下位まで落ちて**サブスク認証情報が第三者に送信される**
- `ANTHROPIC_SMALL_FAST_MODEL` を必ず同じモデルで埋める（未設定だと背景の haiku 呼び出しが 400）
- `CLAUDE_CODE_MAX_OUTPUT_TOKENS` を既定 16000（小さいと thinking モデルが本文を返さない）
- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`（リダイレクト中に本家 API を叩かせない）
- `unset` に `ANTHROPIC_API_KEY`（`env` ブロックでは消せないため、経路ごとに実際に取り除く）

### 2. `server/config/config-schema.ts`

`providerSchema` と、per-dir の `provider` / `model` フィールド（lenient parser、既存の
`dirThemeField` 等と同じ書き方）。

### 3. `server/agents/claude-args.ts`

`model?: string` を受けて `--model` を足す。既存のテスト済み純粋関数。

### 4. `--settings` をインライン JSON → 一時ファイル（0600）

鍵を argv に載せないため。`--settings` はファイルパスも受ける。ファイルには hooks に加えて
`env` ブロックを載せる。**`env` は Claude Code 自身が適用するので、tmux の環境変数伝播にも
docker の `-e` にも依存しない**（#579 の実測参照）。セッション終了時に削除。

### 5. tmux: `ANTHROPIC_API_KEY` をサーバのグローバル環境から除外

実測で「pane は tmux サーバのグローバル環境を継ぐ」ことが分かっているため、既存の
`scrubGlobalEnvironment()`（launcher 変数に対して `set-environment -r` を使う）に 1 つ足す。

### 6. sandbox は当面プロバイダ非対応 → **明示的に拒否**

BASE_URL のループバック書き換えと settings ファイルの bind-mount が要るため、この PR では
sandbox × プロバイダの組み合わせを `ok: false` で弾く。黙って本家に流れる方が危険。

## テスト

- `provider-env.ts`: トークン欠落で拒否、`SMALL_FAST_MODEL` の補完、`maxOutputTokens` 既定値、
  `unset` に `ANTHROPIC_API_KEY` が入ること、provider なし + model だけ、設定なし（何もしない）
- `claude-args.ts`: `--model` の有無
- 設定スキーマ: 不正な provider 参照、baseUrl 末尾の `/v1` を弾く（CC が付けるため）

各テストは「壊したら赤くなる」ことをミューテーションで確認する。
