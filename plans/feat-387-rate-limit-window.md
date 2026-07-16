# feat #387: 5時間/7日レート制限ウィンドウの消費率をツールバーに表示

## User Prompt

> （Zenn記事 https://zenn.dev/sonicmoov/articles/8712598f532b18 を示して）これでやくにたつものある？ mulmoterminalで。
>
> ウィンドウ ってwebだと普通に見えるけど、これってapiでデータ取れるの？
>
> （実装するか → ）はい

記事の statusline が出している項目のうち、コンテキスト使用量（`ModelContextBadge`）とコスト（`/api/cost`）は実装済みで、**5時間/7日ウィンドウの消費率だけが無い**と判明。mulmoterminal は Claude を並列に回すため、アカウント共有リソースであるこのウィンドウを一番速く食い潰す＝一番効く指標。

設計判断（対話で確定）:
1. statusLine は **ユーザが未設定のときだけ注入**（自前 statusLine 持ちは上書きしない）。
2. 空行の実測を受けて **`rateLimitsEnabled`（既定OFF）の opt-in**。ON時は**全セッションに注入**（新鮮さ優先）、表示は**トップヘッダーに1つ**（アカウント共有の値なのでセル単位に出さない）。

## 背景（実コード / 一次情報）

- 公開 HTTP API は**無い**。Messages API の `x-ratelimit-*` / `retry-after` は API キー従量課金枠（RPM/TPM/TPD）で別物。
- transcript にも**無い**（`rate_limits` 出現数 0）→ トークンからの逆算は不可（分母が非公開）。
- **Claude Code の statusLine が stdin で渡す JSON に入っている**（唯一の入手経路）:

```jsonc
"rate_limits": {
  "five_hour": { "used_percentage": 23.5, "resets_at": 1738425600 },  // % は float、resets_at は epoch 秒
  "seven_day": { "used_percentage": 41.2, "resets_at": 1738857600 }
}
```

- 制約（ドキュメント明記）: **Pro/Max のみ** / **最初の API レスポンス後**に出現 / `five_hour`・`seven_day` は**独立に欠けうる**。
- 既存の注入経路に相乗りできる: `hookSettingsJson()`（`server/index.ts:769`）が `claude --settings` で `hooks` を注入し、各フックが `curl -s -X POST /api/hook -H 'x-mt-session: <id>' -d @-` で stdin を POST。statusLine も stdin で JSON を受けるので**同じ形**。

## 変更

- `server/agents/statusline.ts`（新規・純粋関数）
  - `extractRateLimits(payload)` … statusLine payload から 5h/7d を抽出。欠損・型不正・非数値は `null` に落とす。両方無ければ `null`（「表示しない」と「0%」を区別するため）。
  - `statusLineConfigured(rawSettings[])` … user (`~/.claude/settings.json`) と project (`<cwd>/.claude/settings.json`, `settings.local.json`) の各レイヤに `statusLine` があるか。壊れた JSON は「有り」に倒して**注入しない**＝安全側。
  - `statusLineCommand(host, port, sessionId)` … 注入する statusLine コマンド（`curl ... -d @- >/dev/null 2>&1` で出力は空）。
- `server/config/app-config.ts` / `config-routes.ts`
  - `rateLimitsEnabled`（既定 false）を型・既定・sanitize・load・**save**・API 応答に追加。
  - `getRateLimitsEnabled()` を live 参照（次に開くセッションから反映）。
- `server/index.ts`
  - `hookSettingsJson()` に、**opt-in が ON かつ** `statusLineConfigured()` が false のときだけ `statusLine` を混ぜる。
  - `POST /api/rate-limits` … payload を `extractRateLimits` に通して最新値を保持（ウィンドウはアカウント共有なのでグローバルに1件）。
  - `GET /api/rate-limits` … 最新値を返す（無ければ `null`）。
- クライアント
  - `src/composables/useRateLimits.ts` … 取得（AbortController + 8s タイムアウト、ON の間だけ 60s ポーリング、失敗時は前値を保持）。
  - `AppToolbar.vue` … チップ表示（埋まっている方の % を出し、ツールチップに 5h/7d とリセットまでの残り。75% 以上で警告色）。**セル単位ではなくツールバーに1つ**。
  - `SettingsModal.vue` / `App.vue` / `GridView.vue` … トグル（`pushEnabled` と同じ経路）。
- 欠損時（非サブスク / 初回レスポンス前 / 片方欠損）はチップを出さない。

## テスト

- `server/agents/statusline.spec.ts`
  - `extractRateLimits`: 正常 / `rate_limits` 欠損 / 片方欠損 / `used_percentage` が null・文字列・NaN / payload が非オブジェクト。
  - `hasStatusLine`: 有り / 無し / 空 / 壊れた JSON（→ 有り扱い）。
- `server/agents/rate-limit-routes.spec.ts`: 保存 / rate_limits 無しの payload は前値維持 / cross-origin 拒否 / GET 応答（値・null）。
- 既存 `app-config.spec.ts` の全体形の期待値を更新（新フィールド）。

## 実機検証（実施済み）

- **空行は描画される**（実測）。statusLine 無し / 空出力を tmux で並べて比較したところ、空出力側はフッター直上に空行が1行増えた。→ この結果を受けて **`rateLimitsEnabled`（既定OFF）の opt-in** に変更。ONにした人だけが1セルあたり1行を払う。
- **データ源は裏付け済み**（実測）。payload をファイルに落とす statusLine で実セッションを走らせ、`rate_limits: { five_hour: { used_percentage: 11, resets_at: … }, seven_day: { used_percentage: 48, … } }` を実際に受信。ドキュメントは float 例だが実値は int も来るため、`extractRateLimits` は有限数なら受ける。
- **全セッションに注入する理由**: 報告するのは「動いているセッション」だけ（statusLine は会話更新時に再実行され、`rate_limits` は最初のAPIレスポンス後に現れる）。1つに絞るとそのセルがアイドルの間、他セルが燃やした分を取りこぼす。

## ゲート

`yarn format` / `yarn lint` / `yarn typecheck` / `yarn typecheck:server` / `yarn build` / `yarn test`
