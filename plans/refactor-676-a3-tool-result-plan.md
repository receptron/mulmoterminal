# refactor #676 A3 — toolResult 保存フィールド選別と `persistOnly` publish ゲートの pure 関数化

Part of #676（棚卸し第3弾・優先度A の A3）。

## 背景

`POST /api/agent/toolResult`（`server/routes/tool-routes.ts`）は 2 つの呼び出し元を持つ:

- MCP broker: プラグインが結果を出したとき。`persistOnly` を付けない → publish してライブ描画。
- GUI パネル: あるビューが自分の viewState 変更を同じ uuid で永続化するとき。`persistOnly: true` を付ける。

判断ルールは 2 つ:

1. `sessionId` と `persistOnly` を除いた残りを保存対象にする。
2. `persistOnly === true` のときだけ session channel への再 publish を抑止する。再 publish は発生元パネルを再 seed → 再 emit させる**エコー無限フリッカーループ**になる。

`tool-store.spec` はストア挙動のみを見ており、**この判断は未テスト**だった。緩い truthy 判定への「単純化」や strip 対象のズレが、そのままフリッカー再発 or ライブ描画停止になる。

## 変更

- 新ファイル `server/routes/toolResultPlan.ts` に pure 関数 `planToolResultUpdate(body: unknown)` を切り出し。
  - 戻り値: `{ ok: false; error: string } | { ok: true; stored: ToolResult; publish: boolean; sessionId: string; toolName: string }`。
  - 検証順序は現行ハンドラと 1:1（sessionId → toolName → uuid）、エラーメッセージも同一（`invalid sessionId` / `invalid toolName` / `invalid uuid`）。
  - `stored` は body から `sessionId` と `persistOnly` を除いたもの（`uuid`・`toolName`・その他ペイロードは保持）。
  - `publish` は `persistOnly !== true`。strict boolean `true` のみ抑止。
- `server/routes/tool-routes.ts` の POST ハンドラは plan を呼び、`storeToolResult` と `publish`（+ ログ）の I/O だけを行う。GET ルート群は不変。

### 検証の型付けに関する意図的な差分（1点）

現行は `req.body` が `any` のため `!sessionId || !SESSION_ID_RE.test(sessionId)` で検証しており、`sessionId` が「UUID 文字列 1 要素だけの配列」の場合、`test()` の文字列強制で **通過**してしまう（到達不能に近い異常入力）。pure 関数は戻り値 `sessionId: string` を型安全に満たす必要があり（`as` キャスト禁止）、`typeof sessionId !== "string"` で narrow する。結果、この配列ケースは `ok:false`（invalid sessionId）になる。実運用の呼び出し元（broker / GUI）はいずれも文字列 id を送るため到達せず、issue の観点「非文字列 → ok:false」とも一致。この非対称は spec にピン留めしコメントで理由を明記した。

## テスト

`test/server/routes/toolResultPlan.spec.ts`:

- 有効 body → `ok:true`、`stored` に `sessionId`/`persistOnly` を含まない、`publish=true`。
- `persistOnly:true` → `publish=false`、`stored` に `persistOnly` 無し。
- truthy だが厳密に `true` でない `persistOnly`（`"true"`/`1`/`{}`/`[]`）→ `publish=true`（`=== true` を pin）。
- 無効 sessionId（欠落・空文字・非 UUID 文字列・数値・真偽値・オブジェクト・非配列 body・UUID 1 要素配列）→ `ok:false` + `invalid sessionId`。
- 無効 toolName / uuid（現行どおり）→ 各 `invalid toolName` / `invalid uuid`。
- 検証順序（sessionId → toolName → uuid）のピン。

### 変異テスト

`publish = stored.persistOnly !== true` を `!stored.persistOnly`（truthy 判定）に変えると、truthy-but-not-true の 4 ケースが赤くなることを確認 → 戻した。
