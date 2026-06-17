# chore: dev tooling — Prettier + globals + eslint-plugin-security (#25)

## ゴール

`../mulmoclaude` の dev 設定に倣い、不足していた開発ツールを追加する。

## 変更

- **Prettier 一式**:
  - devDeps: `prettier` / `eslint-config-prettier` / `eslint-plugin-prettier`。
  - `.prettierrc`（mulmoclaude と同じ `{ "printWidth": 160 }`）/ `.prettierignore`
    （`dist` / `node_modules` / `yarn.lock` / `*.md`）。
  - `format` / `format:check` スクリプト。
  - `eslint.config.js` に `eslint-plugin-prettier/recommended` を最後に追加
    （`prettier/prettier: error` ＋ 競合する整形ルール off）。
  - 既存コードを `yarn format` で一括整形（printWidth 160 なので折り返しは最小）。
- **globals**: 手書きのグローバル列挙を `globals.browser`（vue）/ `globals.node`
  （server/bin の .js）に置換。
- **eslint-plugin-security**: `configs.recommended` を追加。mulmoclaude と同様に
  `detect-non-literal-fs-filename` / `detect-object-injection` /
  `detect-non-literal-regexp` を off（安全・意図的なパターンに誤検知するため）。
  残りの recommended は有効。新規の違反は出なかった。

## 確認

- `yarn lint`（eslint-plugin-prettier 統合）✅ 0 件 / `yarn format:check` ✅ /
  `yarn typecheck` ✅ / `yarn typecheck:server` ✅ / `yarn test` ✅（16件）/ `yarn build` ✅。
- CI は既存の `yarn lint` ステップで整形違反も検出するため、専用ステップ追加は不要。
