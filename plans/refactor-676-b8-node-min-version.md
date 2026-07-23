# refactor: extract nodeMeetsMinimum pure function (#676 B8)

## Context

`bin/mulmoterminal.js` の `runInit` は `init` プレフライトの Node バージョン判定を
実行ファイルに埋め込んでいた:

```js
const [maj, min] = process.versions.node.split(".").map((n) => Number.parseInt(n, 10));
const nodeOk = maj > 22 || (maj === 22 && min >= 9);
console.log(nodeOk ? `  ✓ Node ${process.versions.node}` : `  ✗ Node ${process.versions.node} — MulmoTerminal needs ≥ 22.9`);
```

表示専用(✓/✗ を出すだけで起動はブロックしない)だが、実行ファイル埋め込みのため
プロセスを起動せずには検証できず未テストだった (#676 優先度 B8)。

`≥ 22.9` の文言と `22 / 9` の閾値が別の場所に散っており、片方だけ動かすと
チェックとメッセージがずれるドリフトの種でもあった。

## 変更

- `bin/cli-args.js`(既存の launcher 決定関数の集約先)に pure 関数を切り出し:
  - `nodeMeetsMinimum(version: string): boolean` — 元のインライン式をそのまま
    パラメータ化。**挙動不変**。
  - `MIN_NODE_MAJOR = 22` / `MIN_NODE_MINOR = 9` を named const 化(マジックナンバー排除)。
  - `MIN_NODE_LABEL = "22.9"` を export し、メッセージの単一ソースにする。
- `bin/cli-args.d.ts` に `nodeMeetsMinimum` と `MIN_NODE_LABEL` の型を追加。
- `bin/mulmoterminal.js` は `nodeMeetsMinimum(process.versions.node)` を呼び、
  メッセージは `MIN_NODE_LABEL` から組み立てる。出力文字列は従来と同一。

### パース仕様(現行に忠実)

- `process.versions.node` は "major.minor.patch"、nightly は patch に
  "-prerelease" タグ("22.9.0-nightly…")。`Number.parseInt` が最初の非数字で
  止まるため、タグは major.minor の比較に届かない。
- 版として読めない文字列は `NaN` にパースされ、`NaN` との比較はすべて false に
  なるので「最低版未満」と判定される — ✓/✗ を描くだけの表示専用チェックとしては
  安全側。

## 検証

- 変異テスト: `MIN_NODE_MINOR` を 9 → 10 に変えると `"22.9.0"→true` 系のテストが
  赤化することを確認して戻した(3 テスト赤化)。
- `prettier --write` / `eslint` はクリーン。
- typecheck 3 種すべて通過:
  - `vue-tsc -b`
  - `tsc -p tsconfig.server.json`
  - `vue-tsc -p tsconfig.test.json --noEmit && tsc -p tsconfig.test-server.json`
- `vitest run test/bin/cli-args.spec.ts`(66 tests green、うち B8 分 10 件追加)。
