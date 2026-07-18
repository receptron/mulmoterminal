# feat #425 — Google カレンダー拡張（非Primary + 色）に追従

Issue: #425。mulmoclaude v1.3.0（`@mulmoclaude/core@0.23.0` / `@mulmoclaude/google-plugin@0.3.0`、
実装 PR mulmoclaude#2164）で入った「非Primary カレンダー + 色」に mulmoterminal を追従させる。

## ゴール

- チャットの `google` ツールと phone の `google.calendar.*` コマンドで、primary 以外のカレンダーの
  イベント読み書き・カレンダー一覧・色パレット取得ができるようにする。

## 設計判断

- **core `^0.22`→`^0.23.0` / google-plugin `^0.2.1`→`^0.3.0`**。google-plugin 0.3.0 は core `^0.23.0` を
  要求するため、core を上げないと npm 実インストールで **core が 2 コピー**（google-plugin 配下に旧 core）に
  なる。`configureGoogleHost` のモジュール状態が割れるので、両方上げる（#408/#415 と同じ罠）。
  実 `npm install` で単一コピー（0.23.0）を確認済み。
- **`yarn add` が `Invariant Violation: expected manifest`（yarn v1 の linking バグ）で失敗**したため、
  package.json のレンジを直接編集 → `yarn install` で解決（install だと通る既知の癖）。
- **remote-host ハンドラは mulmoclaude と shape 完全一致**（同じ phone クライアントが両ホストを叩く）。
  mulmoclaude#2164 が追加した通り:
  - `createEvent` / `listEvents` に `calendarId`（既定 primary）、create に `colorId` を透過
  - 新規 `google.calendar.listCalendars`（`{ calendars }`）/ `google.calendar.colors`（`{ colors: { event, calendar } }`）
  - `calendarId`/`colorId` は trim して空文字は拒否（plugin の Zod `.trim()` に一致）
- **`google` チャットツールは google-plugin 0.3.0 で自動追従**（factory ローダは args を透過するのでホスト無改修）。
  新 kinds: `calendarListCalendars` / `calendarColors`、既存 kind に `calendarId`/`colorId`。
- **新スコープ `calendar.calendarlist.readonly`** は core 0.23.0 の `GOOGLE_SCOPES` に含まれるため、
  `authorizeGoogle` が自動要求 → **CLI `google login` 再実行・設定画面の Unlink→Sign in で再連携すれば取得**。
  ホスト側のスコープ配線は不要。broker（mulmoserver）も対応済み。
- **既存ユーザは再連携が必要**（旧トークンに新スコープが無い）。README に案内を追記。実データでは
  `listCalendars` も `colors` も旧トークンで 403 insufficient scope（issue は colors を calendar.events で
  カバーとするが、実測に合わせ両方 re-link 要と記載）。イベント読み書き（primary）は再連携なしで継続動作。

## 変更ファイル

1. `package.json` / `yarn.lock` — core `^0.23.0`、google-plugin `^0.3.0`、resolutions.core `^0.23.0`。
2. `server/backends/remoteHost/googleCalendar.ts` — `optionalString`（trim+空拒否）、create/list に
   `calendarId`/`colorId`、新 `listCalendars`/`colors` ハンドラ + `toColorMapJson`。
3. `server/backends/remoteHost/handlers.ts` — `google.calendar.listCalendars` / `google.calendar.colors` 登録。
4. `server/backends/remoteHost/googleCalendar.spec.ts` — sampleEvent に `colorId`、stub に `listCalendars`/`getColors`、
   calendarId/colorId 透過・新 2 ハンドラのテスト。
5. `server/backends/remoteHost/handlers.spec.ts` — registration ガードに新 2 コマンド。
6. `README.md` / `docs/mulmoclaude-parity.md` — 新機能と再連携案内、版数更新。

## 検証

- `yarn format` / `lint`（0 errors）/ `typecheck` / `typecheck:server` / `build` / `test`（**1272 passed**、+7）。
- `google` ツールに `calendarListCalendars` / `calendarColors` が出ることを確認。
- **npm 実解決で core 単一コピー（0.23.0）** を確認（2コピー罠なし）。
- 実アカウント疎通（読み取りのみ）: `listEvents` は 0.23 でも動作（`colorId` 付与）、`listCalendars`/`colors` は
  再連携前トークンで 403 insufficient scope（再連携要求を実証）。実際の再連携（consent）は未実施。
