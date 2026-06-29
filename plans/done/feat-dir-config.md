# feat: dirごとの `.mulmoterminal.json`（色・サウンド・バッジ）

Issue: #143

## User Prompt

> dirごとに.mulmoterminal.jsonをおいておくと、色とかサウンドとかカスタムしたいよね！！

スコープ確認の回答:

- **対象**: 端末の色／テーマ・注目サウンド・プロジェクト名／バッジ（自動実行は対象外）
- **色の適用範囲**: その端末セルの色だけ変える（アプリ全体のクロームは変えない）
- **優先順位**: dir設定が優先（手動テーマ選択より `theme` を採用）
- **サウンド参照**: プロジェクトdir内の相対パスのみ（traversal防止）

## 方針

各ディレクトリに `.mulmoterminal.json` を置くと、そのdirで開いた端末にだけ効く新しい設定レイヤを足す。
現状の設定はすべてグローバル（テーマ＝`localStorage`、サウンド＝`~/.mulmoterminal/config.json`）で、
dir単位の層は無い。これを追加する。

### スキーマ（`<cwd>/.mulmoterminal.json` / 全フィールド任意）

```jsonc
{
  "name": "PROD · payments",            // UIのラベル／バッジ
  "badgeColor": "#cf222e",              // バッジ色＆セルのアクセント（hex #rrggbb）
  "theme": "nord",                      // 端末の xterm パレット（midnight/nord/daylight/solarized）
  "colors": { "background": "#190a23", "cursor": "#ff2e63" }, // xtermパレットの部分上書き（任意カラー）
  "sound": "./.mulmoterminal/alert.mp3" // 注目サウンド（このdir配下の相対パスのみ）
}
```

`colors` は `theme`（無ければアプリテーマ）をベースに、xterm `ITheme` の各キー
（`background`/`foreground`/`cursor`/`selectionBackground`/16 ANSI色…）を hex で上書き。
既知キーかつ妥当な hex のみ採用し、不正は無視。`theme` の4プリセットに縛られず任意配色にできる。

## 変更

### サーバ

- `server/dir-config.ts`（新規・テスト対象）:
  - `loadDirConfig(cwd)`: `<cwd>/.mulmoterminal.json` を読み、sanitize して
    `{ name, badgeColor, theme, sound }` を返す（`sound` は cwd 配下に解決した**絶対パス**、
    範囲外・絶対指定・`..` は `null`）。不在/壊れは全フィールド `null`。
  - `publicDirConfig(cwd)`: クライアント向けに `{ name, badgeColor, theme, hasSound }`
    （生のサウンドパスは出さない）。
  - sanitize: `name` は文字列を長さ上限でトリム、`badgeColor` は `#rrggbb` のみ、
    `theme` は既知 id のホワイトリスト、`sound` は相対パスのみ→cwd内に解決。
- `server/dir-config.spec.ts`: sanitize / 範囲外サウンド拒否 / 不正JSON のテスト。
- ルート（`config-routes.ts` に相乗り、または `dir-config-routes.ts`）:
  - `GET /api/dir-config?cwd=<path>` → `publicDirConfig`（cwd は `resolveWorkspace` 検証）。
  - `GET /api/dir-sound?cwd=<path>` → 解決済みサウンドを配信（未設定/不在は 404）。
    パスはリクエストに乗せず、サーバが `.mulmoterminal.json` から引いて cwd 内に再解決。
- `server/index.ts`: `publishActivity` の payload に `cwd`（`ptys.get(id)?.cwd`）を追加。
  注目サウンドのリスナがセッションの dir を引けるようにする。

### フロント

- `composables/useTheme.ts`: `termThemeFor(id): ITheme`（特定テーマのパレット解決）を追加。
- `composables/useDirConfig.ts`（新規）: cwd ごとに `/api/dir-config` を取得しキャッシュ。
  `{ name, badgeColor, theme, hasSound }` を返す。
- `components/Terminal.vue` / `components/TerminalCell.vue`:
  - dir に `theme` があれば `termThemeFor(theme)` を xterm パレットに使う（手動テーマより優先・このセルのみ）。
  - `name`/`badgeColor` をセルヘッダ／セッションタブにバッジ表示。
- `composables/useAttentionSound.ts`: activity の `cwd` を使い、dir にカスタム音があれば
  `/api/dir-sound?cwd=<cwd>` を Web Audio でデコード（cwd キーでキャッシュ）して再生。
  無ければグローバル `soundFile`、無ければ合成チャイムにフォールバック。

### ドキュメント

- `README.md`: `.mulmoterminal.json` のセクション（スキーマ・優先順位・サウンドは相対パスのみ）＋サンプル。

## 優先順位

- グローバル手動テーマ → アプリ全体のクローム＋dir設定の無い端末。
- dir `theme` → その端末のパレットのみ上書き（このセルだけ）。
- サウンド: dir音 > グローバル `soundFile` > 合成チャイム。

## セキュリティ

- `sound` は相対パスのみ。`path.resolve(cwd, sound)` が cwd 配下に収まることを検証し、
  絶対指定・`..` 脱出は拒否。`/api/dir-sound` でも cwd を `resolveWorkspace` 検証し再解決（多層防御）。
- JSON は防御的にパース（try/catch）、各フィールドを型・形検証、不正は無視してデフォルト動作。

## 確認ポイント

- dir 設定はセル単位（アプリ全体のクロームは不変）。
- 手動テーマより dir `theme` が優先されること（該当セルのみ）。
- サウンドは dir 内相対パスのみ・traversal 不可。
- `.mulmoterminal.json` 不在/壊れでも従来動作（無視してデフォルト）。
- 監視は無し（MVP）。変更は端末の開き直しで反映。
