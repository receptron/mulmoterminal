# feat(#677): 更新バッジを Web ヘッダに出す

## 目的
起動時の更新チェック(#654)はコンソール1行のみ。ブラウザだけ見る使い方でも気づけるよう、AppToolbar に控えめなバッジを出す。

## 方式: ファイル経由の共有状態
更新チェックは非同期(〜1.5s)で spawn 時 env に間に合わないため、`~/.mulmoterminal/update-status.json`(既存の共有状態パターン)を介す。チェックは launcher 1回のまま(非ブロッキング・追加NW無し)。

## 変更
1. `bin/mulmoterminal.js`: `checkForUpdate` が算出した notice を `update-status.json`(`{notice, version, at}`)に best-effort 書き込み。opt-out/clean/error では `notice:null`。
2. `server/config/update-status.ts`(新): `parseUpdateStatus(raw)`(純) + `readUpdateStatus()`(ファイル読取)。
3. `server/config/config-routes.ts`: `GET /api/update-status` → `{notice}`。
4. `src/composables/useUpdateStatus.ts`(新): mount で1回 fetch。
5. `src/components/AppToolbar.vue`: notice がある時だけバッジ。title=全文、click=コマンドコピー。

## テスト
- `parseUpdateStatus`: valid/null/壊れ/欠損
- `useUpdateStatus` or バッジ: notice有→表示, null→非表示, コマンド抽出
- launcher 書き込み: 統合確認

## 非対象
- 定期再チェック(起動時1回)。更新後は次回起動で上書きされ消える。
