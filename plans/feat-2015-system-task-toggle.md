# feat #2015 — 組み込み system task を無効にする設定

## 要望

`buildSystemTasks` が feed-refresh（root ごと）と google-calendar-sync を**無条件で**返す。
トグルがあるのは worklog だけで、設定キーも環境変数も無い（#2015 の報告どおり、実コードで確認済み）。

非対称でもある: `tasks.json` の **user task** は `enabled: false` を尊重する
（`buildUserTaskDefinitions`、`server/backends/scheduler.ts`）のに、アプリが登録した task には
その手段が無い。issue が指しているのはこの非対称。

## 決めたこと

**フラットな boolean 2 本、既定 true。**

```json
{ "feedRefreshEnabled": false, "calendarSyncEnabled": false }
```

- issue の提案は `systemTasks: { feedRefresh, calendarSync }` というネスト形。**採らなかった。**
  worklog という 3 つ目の system task が既に `worklogEnabled` というフラットキーで存在しており、
  片方だけネストにするとリポジトリ内で作法が割れる。
- **既定は必ず ON。** 既存の挙動なので、既定を off にすると feed を登録している人のワークスペースが
  アップグレードで黙って更新されなくなる — スイッチが直そうとしている問題より悪い。
  `input !== false`（`sanitizePrWorkdirFooter` / `sanitizeAppendSystemPrompt` と同じ既存の作法）で、
  キー不在・`null`・`0`・文字列 `"false"` はすべて ON のまま。
  これは user task の `enabled` が既に従っている規則でもある。
- **反映は次回起動から。** scheduler は boot で 1 回だけ登録する。`feedRoots` が同じ理由で boot 読みなのと同じ。

## 触るもの

1. `server/backends/system-tasks.ts` — `SystemTaskDeps.enabled: SystemTaskSwitches` を追加し、
   off の側を配列から落とす（`worklogSystemTask` が既に `null` を返し `.filter` が居るので同じ形に乗る）。
2. `server/config/app-config.ts` — 2 キー（interface / 既定 / sanitizer / parse / merge / serve）。
3. `server/config/config-routes.ts` — `getSystemTaskSwitches()`。
4. `server/index.ts` — boot で渡す。
5. `src/composables/systemTasks.ts` — `createGlobalFlag(field, true)` ×2。
6. `src/components/settings/SessionSection.vue` + i18n(en/ja) — チェックボックス 2 つ。
7. `test/server/config/settings-coverage.spec.ts` + `mulmoterminal-config` skill + README。

## 検証

- **実機で条件を振る**（build が通っただけでは動作の証明にならない）:
  ①設定なし → `systemTasks: 2`、②`calendarSyncEnabled:false` → `systemTasks: 1`（feed のみ）、
  ③両方 false → `systemTasks: 0` かつ `config/scheduler` も `data/scheduler` も作られない。
- **既定 ON がテストで噛むこと**を、サーバ側 sanitizer とフロント側 `defaultOn` の
  両方を反転させて赤になることで確認する。ここを逆にすると既存ユーザーが黙って壊れる。
- `yarn format` → `lint` → `build` → `typecheck` → `test`。

## やらないこと

- **worklog は触らない。** 既に自分のキーを持っている。両方 off にしても worklog は残る（spec で固定）。
- **実行中の反映はしない。** scheduler は boot で 1 回登録する設計で、動的な登録解除は別の話。
- `data/notifier/` は boot で無条件に作られるため、**このトグルだけでは
  「プロジェクトフォルダに何も作らない」は達成できない**。そちらは #2024 / PR #2025。
