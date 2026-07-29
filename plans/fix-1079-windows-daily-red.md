# fix(windows): windows-daily を緑に戻す (#1079)

`Windows (daily)` は `622ada44`（#1065 のマージ）以降ずっと赤い。Node 22.x / 24.x の両方で
同じ 2 件が落ちる。**どちらもテスト側のバグで、製品コードは Windows で正しく動く。**

ただし両方とも「テストが Windows では別のものを見ている」という形なので、**その経路が
Windows CI で一度も検証されていない**という副作用がある。直すと初めて検証されるようになる。

## (1) `test/server/backends/html.spec.ts` — URL 組み立てが POSIX の先頭空要素に依存

```js
const res = await fetch(`${base}/htmlfile/abs${abs.split(path.sep).map(encodeURIComponent).join("/")}`);
```

POSIX の絶対パスは `/` で始まるので `split(path.sep)` の先頭要素が `""` になり、`join("/")` が
scope との区切りを補う。Windows には先頭の空要素が無いので、ドライブレターが `abs` に直結する。

| | 生成される URL | resolver が読む scope |
| --- | --- | --- |
| POSIX | `/htmlfile/abs/tmp/…/report.html` | `abs` → 200 |
| Windows | `/htmlfile/absC%3A/Users/…/report.html` | **`absC:`** → `null` → 404 |

`@mulmoclaude/core` の `resolveHtmlFileRequestPath` は `/^[a-zA-Z]:$/` でドライブレターを
正しく扱う。**製品側は正しく、テストがその分岐に到達していないだけ。**

**直し方** — 区切りを空要素に頼らず、明示的に組み立てる:

```ts
const htmlFileUrl = (abs: string) => ["abs", ...abs.split(path.sep).filter(Boolean).map(encodeURIComponent)].join("/");
```

`filter(Boolean)` が POSIX の先頭 `""` を落とし、`join` が常に `abs` の直後に `/` を置く。

- POSIX: `abs/tmp/…` → rest[0] = `tmp` → `/tmp/…` ✓
- Windows: `abs/C%3A/Users/…` → rest[0] = `C:` → ドライブレター分岐 → `C:\Users\…` ✓

`path.win32` / `path.posix` で resolver を再現して両方を確認済み。

## (2) `test/bin/instances.spec.ts` — `process.env.HOME` では Windows の `os.homedir()` は動かない

テストは `process.env.HOME` を一時ディレクトリに差し替えるが、`bin/instances.js:17` は
`os.homedir()` を使う。**Windows の `os.homedir()` は `USERPROFILE` を読む**ので差し替えが効かず、
コードはランナーの実ホームを走査する。

結果、`removes an entry whose owner is genuinely gone` はテスト用ディレクトリのファイルが
消えずに落ちる。

**もう 1 件は無言で無意味になっている。** `leaves an entry it cannot parse alone` は
「ファイルが**残っている**こと」を assert するので、コードが別の場所を見ていれば自動的に通る。
`docs/windows-gotchas.md` の「A stubbed predicate … fails silently」と同じ形で、
**落ちるテストより、通っているのに何も検証していないテストのほうが危ない。**

**直し方** — `withHome` が `HOME` と `USERPROFILE` の両方を差し替え、両方を元に戻す。
`os.homedir()` がどちらを読む環境でも同じ一時ディレクトリを指すようにする。

さらに、この罠が二度と無言にならないよう **`instancesDir()` が差し替えた home の下を指していることを
assert するテストを 1 件足す**。これが通れば、以降どのプラットフォームでも「コードが別の場所を
見ている」状態が沈黙ではなく失敗として出る。

## 検証

`windows-daily.yaml` は **PR では走らない**（daily と `main` push のみ）。
`docs/windows-gotchas.md` の手順どおり、マージ前にブランチ ref で dispatch して実機で確認する:

```
gh workflow run windows-daily.yaml --ref fix/1079-windows-daily-red
```

ローカル（macOS）の `yarn test` はこの 2 件について**元から緑**なので、ローカルの緑は
何の証拠にもならない。実機の結果を待ってから PR をマージ可能とみなす。

## やらないこと

- 製品コードは変えない。2 件とも製品側は正しい
- `windows-daily` を PR で走らせる変更はしない — 再発防止として検討の価値はあるが
  （#478 / #802 / #858 と同じ系統の再発である）、CI 時間の判断が要るので #1079 に論点として残す
