# feat: startup update notice + unit test (#38)

## ゴール

`npm i -g mulmoterminal` は自動更新されないので、起動時に npm 最新版と比較して
更新案内を出す。ロジックは unit test して CI で回す。

## 変更

- **`bin/update-check.js`**（新規・テスト可能に分離）:
  - `fetchLatestVersion(pkg?)` — `${registry}/<pkg>/latest` を取得。1.5s タイムアウト、
    失敗（オフライン/非OK/パース不可）は `null`。`npm_config_registry` を尊重。
  - `isNewerVersion(latest, current)` — major.minor.patch を**数値比較**（pre-release は無視）。
    0.1.10 > 0.1.9 を正しく判定（文字列比較のバグを回避）。
- **`bin/mulmoterminal.js`**: 上記を import。`checkForUpdate()` を起動時（`--version`/`--help`
  以外）に**非ブロッキング**で呼び、新しければ黄色で1行案内。
  `MULMOTERMINAL_NO_UPDATE_CHECK` / `NO_UPDATE_NOTIFIER` でオプトアウト。
- **`bin/update-check.spec.ts`**（新規 unit test, vitest）:
  - `isNewerVersion` 9ケース（新しい/同じ/古い/数値比較/pre-release）。
  - `fetchLatestVersion` 4ケース（200→version / 非OK→null / reject→null / version無→null、`fetch` を vi.stubGlobal）。
- README に更新チェックの記載＋オプトアウト。

## CI

`lint-and-build` の既存 `yarn test`（vitest）が `bin/**.spec.ts` を自動で拾う（vitest デフォルト include）。
専用ステップ追加は不要。

## 検証

- `yarn test` 16 → **29 件**（新規13）緑 / `lint` / `format:check` / `build` 緑。
- 実機: 古い version を擬似 → `Update available: 0.0.1 → 0.1.3 …` 表示。最新時は無音。起動はブロックしない。

## 備考

マージ後 0.1.4 として publish 予定。
