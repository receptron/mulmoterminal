# feat #386 — Google 連携（ローカル OAuth + Calendar）+ PluginRuntime ホスト

Issue: #386。A（#386 本体）と B（PluginRuntime ホスト）を 1 本の PR で実装する。
B は A の前提条件: `@mulmoclaude/google-plugin` が factory 形式で、ホスト側に
PluginRuntime の実装が無いと**そもそもロードできない**ため。

## ゴール

- `@mulmoclaude/core/google` を使い、Google 連携（ローカル OAuth + Calendar）を MulmoTerminal に載せる。
- チャットのツール面（`google` ツール）も `@mulmoclaude/google-plugin` で有効化する。

## 設計判断

- **core は `^0.20.1`**（issue の `^0.20.0` ではなく）。google-plugin が `core@^0.20.1` を要求するため、
  `^0.20.0` だと **core が 2 コピー**入り得る。`configureGoogleHost` はモジュール状態なので、
  コピーが分かれると logger 注入が片方にしか効かない。単一コピーであることを確認済み。
- **トークン/シークレットのパスは core 所有・host 中立・共有**
  （`~/.config/mulmo/google-token.json` / `~/.secrets/client_secret_*.json`）。
  mulmoclaude#2124 が mulmoclaude ブランドのパスから移し、読み取り時に旧パスを移行する。
  issue の「判断ポイント」はこれで解消済み → **dir override は足さない**（1 マシン 1 連携で両アプリ共用）。
- **認可は設定 UI（主）+ CLI（フォールバック）の 2 経路**。同意フローは loopback リスナーを
  **サーバのマシン**に立てるが、MulmoTerminal の通常の使い方は同じマシンのブラウザで localhost を
  開く形なので、**設定画面からのログインは成立する**（当初 CLI のみとしたのは、この制約を
  「ブラウザからは不可」と過大に読んだ誤り）。ブラウザが別マシンのときだけ CLI が要る。
  core が `googleAuthFlow`（single-flight の HTTP 向けフロー管理）を export しているのは、
  まさにこの HTTP/設定 UI 経路のため。mulmoclaude も両方持っている（参考: mulmoclaude#2113）。
- **CLI はブラウザ自動起動をしない**（URL 提示のみ）— シェル経由の URL 起動はクォート/クロス
  プラットフォームの地雷。設定 UI 側は `window.open` で新規タブを開く。
- **`window.open` の戻り値は見ない**。`noopener` 付きは**成功時も null を返す**（実測確認済み）ため、
  「null ならポップアップブロック」という検出は書けない（書くと毎回サインインが壊れる）。
  `noopener` は reverse tabnabbing 対策として維持する。
- **ハンドラは mulmoclaude と shape 完全一致**（param 名 `summary`/`start`/`end`/`description`、
  `timeMin`/`maxResults`、結果 `{event}` / `{events}`）。同じ phone クライアント（mulmoserver）が
  両ホストを叩くため。参考実装: mulmoclaude `server/remoteHost/handlers/googleCalendar.ts`。
  日時検証はローカル正規表現ではなく core の `isIsoDateTimeWithOffset` を使う（実在日付・小数秒・
  オフセット範囲まで見るので参考実装より厳密）。
- **capabilities は登録から自動導出**なので、未連携でも 2 コマンドを無条件に広告する。連携は
  ホストマシン側の操作であり、phone は「未連携エラー」でしか気付けないため。
- **PluginRuntime の dir 方針**: `<workspace>/data/plugins/<pkg>/` と `<workspace>/config/plugins/<pkg>/`。
  既存の `data/wiki` / `config/scheduler` レイアウトに合わせる。パッケージ名は slug 化して
  スコープ名（@scope/pkg）が path separator を持ち込めないようにする。
- **artifacts は共有**（ユーザーが閲覧する領域なので per-plugin にしない）。data/config のみ per-plugin。
- `rootFor` は **操作ごとに評価**する thunk。plugins-registry は import 時（top-level await）に
  factory を呼ぶため、workspace 注入（boot）より **先に** FileOps がクロージャに束縛される。

## 変更ファイル

1. `package.json` — `@mulmoclaude/core` `^0.12.1` → `^0.20.1`、`@mulmoclaude/google-plugin` `^0.1.1` 追加。
2. `server/backends/fileOps.ts`（新規）— root 付き `FileOps` + 封じ込めガードを 1 箇所に集約。
3. `server/backends/artifacts.ts` — 上記に載せ替え（`initArtifactsBackend` / `artifactsRoot`）。
4. `server/infra/pluginRuntime.ts`（新規）— `initPluginRuntime` / `createPluginRuntime`。
   pubsub（`plugin:<pkg>:*` に名前空間化）、locale、per-package files、prefix 付き log、
   timeout + allowedHosts 付き fetch/fetchJson。
5. `server/infra/plugins-registry.ts` — `isPluginFactory` で factory 形式を判別し `loadFactoryPackage` で適合。
6. `plugins/plugins.json` — `@mulmoclaude/google-plugin` を `packages` に追加（XTool ではないので `servers` ではない）。
7. `server/backends/hostLogger.ts`（新規）— `(prefix, message, data?)` logger を共有（Google/Collection で同一形）。
8. `server/backends/collections.ts` — ローカル log shim を `hostLogger` に置換。
9. `server/backends/google.ts`（新規）— boot 時 `configureGoogleHost({ log })`。
10. `server/backends/remoteHost/googleCalendar.ts`（新規）— `google.calendar.createEvent` / `listEvents`。
11. `server/backends/remoteHost/handlers.ts` — 上記 2 コマンドを登録。
12. `server/cli-google.ts`（新規）+ `bin/mulmoterminal.js` — `mulmoterminal google login`。
13. `server/index.ts` — boot 配線（`initPluginRuntime` → `initGoogleBackend`）+ `mountGoogleRoutes`。
14. `README.md` / `docs/mulmoclaude-parity.md` — 認可の 2 経路と共有subsystem の記載。
15. `server/backends/google.ts` — 設定 UI 用の 3 ルート（`GET /api/google/status`,
    `POST /api/google/authorize`, `POST /api/google/unlink`）。既存の副作用系ルートと同じく
    `isAllowedOrigin` ガード必須 — 無いと訪問先の任意サイトから `/unlink` を POST されて
    連携が飛ぶ（CSRF）。トークンはレスポンスに一切出さず、`linked` は refresh token の有無で判定。
16. `src/composables/useGoogleLink.ts`（新規）+ `src/components/SettingsModal.vue` — 設定画面の
    「Google account」セクション。ロジックは composable（`useCost` と同じ前例）、マークアップは
    モーダルにインライン（既存セクションと同様。スタイルが scoped なので子コンポーネント化すると重複する）。
    モーダルは `v-if` で毎回再マウントされるので、mulmoclaude の `reloadToken` prop は不要。

## 検証

- 単体: googleCalendar（検証・clamp・配線／エンジンは stub＝ネットワーク無し・トークン無し）、
  fileOps（round-trip・traversal ガード・root 名の prefix 衝突）、pluginRuntime（per-package 隔離・
  pubsub 名前空間・fetch の allowedHosts/timeout）、plugins-registry（factory 経路で `google` が載ること）、
  google routes（origin ガード・トークン非露出・エラー時 500）、useGoogleLink（ポーリング・backoff・dispose）。
- `yarn format` / `lint`（0 errors）/ `typecheck` / `typecheck:server` / `build` / `test`。
- 実起動: サーバを空きポートで起動し、`/api/tools` に `google` が出ることを確認。
- CLI: help / 不明コマンド / `login` が同意 URL を出すところまで（**承認はしない**）。
- 設定 UI: 実ブラウザ（puppeteer）で設定モーダルを開き、`Linked`（緑）+ `Unlink` 表示・
  コンソールエラー 0 を確認。Origin ガードは foreign origin で 403、Origin 無し（CLI）は 200。
  サインインは `/api/google/*` をスタブ応答にして押下し、新規タブが実際に開くことを確認
  （実サーバには非到達なので本物の同意フローは開始しない）。
- 実アカウントでの疎通（連携後）: remote-host の `listEvents` と `google` ツールの
  `status` / `calendarListEvents` が実データを返すことを確認（読み取りのみ。イベント作成は未実行）。
