# feat: 通知音を設定で変えられるようにする（任意の音声ファイルパス）

## User Prompt

> terminal のサウンド、設定で変えられるようにしたい。npm での配布も気をつけてね。オーディオファイルなら同梱必要になるから。
>
> 設定ファイルで任意のファイルのパスを指定して、鳴らしてもよいけどね。

## 方針

現状の通知音は Web Audio で合成した2音チャイム（**アセットファイル無し**、`useAttentionSound.ts`）。
これを**デフォルトのまま残し**、設定で**任意の音声ファイルのパス**を指定したらそれを鳴らす。

- **npm 配布**: 音源を同梱しない（デフォルト＝合成、カスタム＝ユーザー自身のファイルの絶対パス）。
  `package.json` の `files` 等は変更不要。バンドルもライセンスも無問題。

## 変更

### サーバ
- `server/app-config.ts`（新規・テスト対象）: `~/.mulmoterminal/config.json` を `{ cwdPresets, soundFile }`
  として読み書き（`sanitizePresets` 再利用、`sanitizeSoundFile`）。
- `server/config-routes.ts`: app-config を使用。`GET /api/config` が `soundFile` を返す。`POST /api/config`
  は `cwdPresets` / `soundFile` を部分更新。`GET /api/sound` … 設定された音声ファイルを配信（未設定/不在は 404）。
- `server/app-config.spec.ts`: sanitize / load / save のテスト。

### フロント
- `composables/useAppConfig.ts`: `soundFile` ref を追加、保存を `cwdPresets` と `soundFile` 両対応に。
- `composables/useAttentionSound.ts`: `soundFile` があれば `/api/sound?v=<path>` を Web Audio でデコードして再生
  （unlock 済み AudioContext を流用、バッファをキャッシュ、パス変更で再読込）。失敗時は合成チャイムにフォールバック。
- `App.vue`: `useAppConfig` の `soundFile` を `useAttentionSound` に渡す。
- `components/SettingsModal.vue`: 「Notification sound」欄（パス入力＋ `/api/pick-file` で参照＋テスト再生＋クリア）。

### ドキュメント
- `README.md`: カスタム通知音（`soundFile`）の設定方法と「同梱なし＝npm 軽量」を明記。

## 確認ポイント
- デフォルトは合成チャイム（音源同梱なし）。カスタムはユーザーの絶対パス。
- `/api/sound` はサーバ設定の path のみ配信（リクエストからパスを受け取らない＝traversal なし）。
