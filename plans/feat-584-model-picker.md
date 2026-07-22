# feat #584 — 起動時のモデル選択 + ヘッダー表示 + ヘルプ + ドキュメント

#579 / #580 でディレクトリ単位のプロバイダ指定が入った。その上に、選ぶ・見える・分かる導線を載せる。

## 1. モデル preset（`common/modelPresets.ts`）

**動的取得はしない。** OpenRouter は `${baseUrl}/v1/models` で当たるが、Moonshot の Anthropic 互換
`/anthropic` の下にカタログは無く（実測 404）、**カタログ URL は `ANTHROPIC_BASE_URL` から導出できない**。
プロバイダごとの `modelsUrl` ＋ キャッシュ ＋ 失効表示を抱えるより、組み込み preset ＋ ユーザー追加が軽い。

各エントリは**実測値**を持つ。`-p "say routed"` が通ってもツールループが壊れているモデルがあり、
単発では判定できない（2 モデルが試行間で PASS/FAIL を往復した）ため、比率で持つ:

- `measured` — 通過数 / 試行数 / 中央値秒 / 計測日
- `unreachable` — アカウントのプライバシー設定で到達不能。**モデルの欠陥ではない**
- `unmeasured` — ユーザーが自分で足したもの

計測は `scripts/model-trials.ts`（本番と同じ spawn 経路で、ファイルを読んで書かせる）。preset を
更新するときはこれを回す。

## 2. ヘッダー Row 1 のモデル表示

既に `ModelContextBadge` が Row 1 にあり `/api/session/:id` の `model` を出している。preset を参照して:

- **ラベル** — `moonshotai/kimi-k2.7-code` → `Kimi K2.7 Code`（現状は id の末尾）
- **コンテキスト長** — preset の `contextLength` を使う。現状は Claude 系の substring リストに
  無いモデルで % を出さない（「決して推測しない」という既存方針は正しいので、**推測ではなく実データで埋める**）

## 3. 起動時のピッカー

新規ターミナルの起動フォームに provider / model のセレクトを出す。**使えるプロバイダがあるときだけ**。

選択の寿命は**そのセッションだけ**。`.mulmoterminal.json` の `provider` / `model` は既定値で、
選ばなければそれが使われる。あのファイルはユーザーが手で管理していて色・テーマ・スキルが同居するため、
mulmoterminal が書き戻すのは別の判断として後回しにする。

起動時の選択は ws の検索パラメータで渡す（`cwd` / `gui` と同じ経路）。`spawnClaudePty` は既に引数 7 個で
lint 上限のため、引数は増やさず**セッション id をキーにした受け渡し**にする。

## 4. ヘルプ

プロバイダ未設定、または鍵が解決できないときに起動フォームから開ける。**そのとき足りていないものだけ**を出す:

- `~/.mulmoterminal/config.json` の `providers` の例（コピー可）
- 鍵はサーバの環境変数（`.env`）に置く。**設定ファイルには書かない**
- `.mulmoterminal.json` に既定を書く例
- 「LLM に設定してもらう」導線

`resolveProvider` は既に理由つきで拒否する（「`OPENROUTER_API_KEY` が要る」等）ので、その文言をそのまま使う。

## 5. ドキュメント

`docs/guide/{ja,en}` に追記（このリポジトリの docs は Jekyll + markdown）。設定の書き方、鍵の置き場所、
preset の意味（通過率・中央値）、到達不能の説明。

## 6. 設定支援スキル

`server/skills/mulmoterminal-config/SKILL.md` に provider / model の節を足す。既存スキルが
`palettes.json` を出典にするのと同じ関係で、**`common/modelPresets.ts` を唯一の出典**として読ませる。

## テスト

- preset: 重複 id、ユーザー追加のマージ、`unmeasured` が付くこと
- バッジ: preset にあるモデルのラベルと ctx%、無いモデルで % を出さないこと（既存方針の回帰）
- ピッカー: プロバイダが無いときに出ないこと、選択が ws パラメータに乗ること
- 起動時の選択が dir 設定の既定を上書きすること
