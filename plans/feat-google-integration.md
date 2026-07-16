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
- **認可は CLI のみ**（`npx mulmoterminal google login`）。同意フローは loopback リスナーを
  **このマシン**に立てるため、リモート/スマホのブラウザからは完了できない。Web UI にボタンは置かない。
  ブラウザ自動起動はしない（URL 提示のみ）— シェル経由の URL 起動はクォート/クロスプラットフォームの
  地雷で、issue 要件（「CLI 一発で最小」）にも不要。
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
13. `server/index.ts` — boot 配線（`initPluginRuntime` → `initGoogleBackend`）。
14. `README.md` / `docs/mulmoclaude-parity.md` — CLI と共有subsystem の記載。

## 検証

- 単体: googleCalendar（検証・clamp・配線／エンジンは stub＝ネットワーク無し・トークン無し）、
  fileOps（round-trip・traversal ガード・root 名の prefix 衝突）、pluginRuntime（per-package 隔離・
  pubsub 名前空間・fetch の allowedHosts/timeout）、plugins-registry（factory 経路で `google` が載ること）。
- `yarn format` / `lint`（0 errors）/ `typecheck` / `typecheck:server` / `build` / `test`。
- 実起動: サーバを空きポートで起動し、`/api/tools` に `google` が出ることを確認。
- CLI: help / 不明コマンド / `login` が同意 URL を出すところまで（**承認はしない**）。
