# fix: config.json が壊れていると次の設定保存で全設定が消える（#741）

## User Prompt

> mulmoclaude で全ファイルをレビューして…（略）バグを issue 化し、順に対応・CI・レビュー対応・マージまで進める

## 症状

`~/.mulmoterminal/config.json` が壊れている（手編集で余計なカンマが入った等）と、
設定 UI で何か 1 項目を保存した瞬間に presets / launchers / providers / buttons / chips / userMcpServers が全部消える。
バックアップも取られず、エラー表示も出ない。

## 原因

`loadAppConfig` が JSON パース失敗を catch して `emptyConfig()` を返す（＝「ファイル不在」と区別できない）。
`config-routes.ts` の POST ハンドラと `cli-init.ts` はこれを `mergeConfigUpdate` のベースに使うため、
破損時は空のベースに body をマージして書き戻し、省略フィールドが全て空で確定する。

## 修正（決定を pure 関数に、I/O は呼び出し側）

`server/config/app-config.ts`:
- `sanitizeAppConfig(raw)` を pure 関数として切り出し（旧 `loadAppConfig` の中身）。
- `loadAppConfigResult(file): { status: "ok" | "missing" | "corrupt" }` を追加。
  「不在」と「破損」を区別する。書き込み経路はこれを使う。
- `loadAppConfig` は `loadAppConfigResult` の薄いラッパに（不在・破損とも空を返す寛容ロード。
  boot の読み取り専用用途はクラッシュさせない）。既存シグネチャ・挙動は維持。
- `backupCorruptConfig(file)` を追加。破損ファイルを `config.json.corrupt.bak` に退避（best-effort）。

`server/config/config-routes.ts`（POST /api/config）:
- `loadAppConfigResult` で読み、`corrupt` なら退避して 409 を返し**上書きしない**。
- `ok`/`missing` の場合のみ従来どおり merge → save。

`server/cli-init.ts`（プリセット seeding）:
- 同じハザードがあるため、`corrupt` なら書き込まず exit 1。

## テスト

`test/server/config/app-config.spec.ts`:
- `loadAppConfigResult`: missing / corrupt / ok を区別すること。
- `backupCorruptConfig`: 退避コピーができること、失敗時 null。
- #741 シナリオ: 正常ベースは pushEnabled のみ更新で全フィールド保持。
  破損ベースは merge の**前に**検出される（旧寛容ロードだと空ベースで全消しになることも同テストで証明）。

破損を missing 扱いに変えるミューテーションでシナリオテストが赤になることを確認済み。
全 3539 テストパス。
