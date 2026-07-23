# refactor: extract sessionListTitle pure function (#676 A4)

## Context

`server/session/session-reads.ts` の `readSessionMeta` はサイドバー行のタイトルを
5 段の優先順位で決めていた:

```ts
const title = aiTitles.get(id) || aiTitle || lastPrompt || firstUserMsg || "(untitled session)";
```

「ライブ AI タイトル > ディスク ai-title > ディスク last-prompt > 最初のユーザ発言 >
フォールバック」。空文字を飛ばす `||` セマンティクスが load-bearing で、`session-detail-view.ts`
の `??`(空文字を勝たせる `/clear` の契約)とは**別物**。この判断は pure 関数として
未抽出・未テストだった (#676 優先度 A4)。

## 変更

- 新ファイル `server/session/sessionListTitle.ts` に pure 関数 `sessionListTitle` を切り出し。
  - シグネチャ: `sessionListTitle(input: { liveAiTitle: string | undefined; diskAiTitle: string | null; diskLastPrompt: string | null; firstUserMsg: string | null }): string`
  - 型は元の値に忠実: `aiTitles.get(id)` は `string | undefined`、他 3 つは `string | null`。
  - `UNTITLED_SESSION = "(untitled session)"` を named const として公開。
  - `||`(空文字スキップ)を厳密に維持 — **挙動不変**。
- `readSessionMeta` は入力収集 (I/O) だけ残し、この関数を呼ぶ。
- テスト `test/server/session/sessionListTitle.spec.ts`:
  - live があればそれが勝つ / live 不在で disk-ai → last-prompt → first の順に落ちる
  - 各段の空文字 `""` をスキップ(`||` の pin)
  - live="" かつ disk-ai="実タイトル" → "実タイトル"(`??` との差を固定)
  - 全 null/undefined、および全 "" → sentinel

## 検証

- 変異テスト: `||` → `??` に変えると空文字スキップの pin が赤になることを確認して戻す。
- `prettier --write` / `eslint` / `typecheck` / `typecheck:server` / `typecheck:test` /
  `vitest run test/server/session`。
