# chore: stricter lint (typescript-eslint strict + eslint-plugin-sonarjs)

## ゴール

lint ルールを厳し目にする。`eslint-plugin-sonarjs` を導入し、`typescript-eslint`
を `recommended` → `strict` に引き上げ、出た違反を実コード修正で解消する。

## 変更

- `eslint-plugin-sonarjs`（v4）を devDependency に追加。
- `eslint.config.js`: `tseslint.configs.recommended` → `strict`、`sonarjs.configs.recommended` を追加。
- 違反修正（全13件、`any`/`as` 不使用）:
  - **no-non-null-assertion**（PluginFrame.vue / Terminal.vue）: `ref.value!` を
    `const x = ref.value; if (!x) return;` のガードに置換。
  - **unified-signatures**（Sidebar.vue / SessionTabBar.vue）: ペイロードなしの
    emit 3つを `(e: "new" | "toggle-layout" | "refresh"): void` に統合。
  - **no-invalid-void-type**（ToolsPane.spec.ts）: `deferred<void>()` →
    `deferred<undefined>()`（`resolve(undefined)`）。
  - **cognitive-complexity**（server/index.ts、3関数）: `readSessionMeta`、
    `/api/hook` ハンドラ、WebSocket 接続ハンドラを小さな名前付き関数に分割
    （`userPromptText` / `parseJsonl` / `handleActivityHook` / `handleToolHook` /
    `reattachPty` / `spawnClaudePty` / `handleClientFrame` / `handleClientClose`）。挙動は不変。

## 確認

- `yarn lint` ✅ / `yarn typecheck` ✅ / `yarn typecheck:server` ✅ /
  `yarn test` ✅（16件）/ `yarn build` ✅ / tsx 起動 ✅。
