# feat: npm パッケージ化（`npx mulmoterminal`）(#21)

## ゴール

`npx mulmoterminal` / `npm i -g mulmoterminal` で起動できる npm パッケージにする。
`receptron/mulmoclaude`（`packages/mulmoclaude`）の構成を参考にする。

## 方針

mulmoclaude と同じく **サーバーは TypeScript のまま同梱して `tsx` で実行**、
クライアントはビルド済み（`dist/`）を同梱、`bin/` に plain-JS ランチャを置く。
MulmoTerminal は単一パッケージなので、リポジトリルートから直接 publish 可能
（mulmoclaude のような monorepo→subpackage コピーは不要）。

## 変更

- `bin/mulmoterminal.js`（plain JS, shebang）: `claude` 存在チェック → 空きポート
  探索（`net` で自前 probe）→ `node --import tsx server/index.ts` を spawn → 起動
  完了をポーリングしてブラウザを開く。`--port` / `--no-open` / `--version` / `--help`。
- `package.json`:
  - `private` 削除、`version` 0.1.0。
  - `description` / `license: MIT` / `repository` / `keywords` / `bin` / `files` 追加。
  - `files`: `bin/` `dist/` `server/` `plugins/`。
  - `tsx` を devDependencies → dependencies へ移動（実行時に必要）。
  - `prepack: yarn build`（pack/publish 前に `dist/` を生成）。
  - `postinstall`（fix-pty-perms.js）は維持、`node-pty` は dependencies のまま。
- `LICENSE`（MIT）追加。
- README に「Install & run」節を追加。

## 同梱物の根拠

- サーバーは `../src` を import しない＝Vue ソースは同梱不要。
- `plugins/plugins.json` は npm パッケージのみ参照（local プラグインなし）＝
  `plugins/` を同梱すれば足りる（参照パッケージは dependencies）。
- サーバーは `path.join(__dirname, "../dist")` を静的配信＝`dist/` を同梱。

## 検証

- `npm pack --dry-run` で同梱物に bin/dist/server/plugins/LICENSE/README が含まれることを確認。
- tgz を一時ディレクトリに install → `mulmoterminal --no-open --port <n>` で
  `MulmoTerminal is ready` とサーバー起動を確認。

## 備考

- 実際の `npm publish` は別ステップ（認証・最終バージョン確定）。本 PR はパッケージ化まで。
- `license`（MIT）・`version`（0.1.0）・copyright holder（Receptron）は要確認の前提。
