# fix #1970 — リポジトリ内のデッキが Canvas で編集できない

## 症状

`<workspace>/<repo>/decks/launch.json` を Files ペインから Canvas で開くと、開くところまでは通るが

- Media タブ: 各ビートに `File not found: stories/<repo>/decks/launch.json`
- Edit タブ: 保存しても変わらない。コンソールに `deck save failed: File not found: …`

`<workspace>/artifacts/stories/` に置いたデッキでは起きない。

## 原因

`storyWirePath()` が **登録済み root 配下のデッキだけ `stories/<tail>` + `root` という綴り**を返していた。
カードは `root` を持ち、reopen は `root` を受け取るので**開くのは通る**。

ところがプラグインの View が出す後続の dispatch は `filePath` をそのまま流し、**`root` を送らない**
（`@mulmoclaude/mulmoscript-plugin` 4.6.0 の `dist/vue.js` を読んで確認）:

```
updateScript → { filePath, script, origin }
updateBeat   → { filePath, beatIndex, beat }
beatMovie    → { filePath, beatIndex }
movieStatus / pdfStatus / pendingGenerations / save → { filePath }
```

`root` の無い相対パスをサーバは既定 root（`artifacts/stories/`）として解決するので、
実際の置き場所と食い違って `File not found` になる。

**実測（実サーバ、修正前）:**

```
相対 + root なし → {"ok":false,"code":"not_found","error":"File not found: stories/acme-docs/decks/launch.json"}
絶対 + root なし → {"ok":true}   ファイルが実際に書き変わる
```

## 直し方

`storyWirePath()` から**登録済み root の分岐を削除**し、既定 stories 配下以外は
**そのファイル自身の絶対パス**を返す。**絶対パスは root を持たないので、root を落とす dispatch でも壊れない。**

これは新機能ではない。プラグイン 4.6.0 の `byPath` 形式で、このホストは既に opt-in 済み
（`server/backends/mulmoscript.ts`）、かつ **どの root にも属さないデッキは #1976 で既にこの形**だった。
今回は「登録済み root だけを例外扱いするのをやめる」だけ。

### 併せて直す偽コメント（#1970 の原因そのもの）

`canvasOpenFile.ts` の冒頭が **「mulmoScript は絶対パスを一切受け付けない」** と書いていた。
4.5.2 までは真、4.6.0 で偽。この前提が残っていたために root 配下だけ相対形式のままだった。

## 影響しないこと

- **開けるファイルの範囲**: `canOpenInCanvas` のゲートは変わらない。任意の `.json` は #1976 以降すでに対象。
- **カードの同一視（登録済み root 配下）**: 綴りは **その root の canonical**（サーバが realpath した綴り）
  で mint する。`canonicalCardPath` が `stories/…`+root を解決する先と同じ綴りなので、エージェントが
  作ったカードと 1 枚に畳まれる。ブラウザは realpath できないので、**canonical を使わずペインの綴りを
  そのまま出すと symlink 経由の workspace で 2 枚に割れる**（Codex round 1 の P2。実測して修正済み、
  `test/src/composables/canvasOpenFile.spec.ts` の「a deck reached two ways is one card」）。
- **どの root にも属さないデッキ**: canonical が無いのでペインの綴りをそのまま出す。同じファイルを
  別綴り（symlink）で開けば 2 枚になる — #1976 以前と同じで、この修正は改善も悪化もさせない。
  閉じられるのはサーバが解決済みパスをカードに載せたときだけ。
- **既定 stories 配下**: 相対のまま。root 無しの dispatch でも正しく解決でき、
  ワークスペース subtree との二重綴りを避けるため先に判定する必要がある。

## 削った到達不能コード

当初は「絶対パスが無いとき（ペインに cwd が無く相対パスで来るとき）の最後の手段」として
root 付き相対を残したが、**実測すると相対入力は全ケースで `null`** を返す
（root の prefix 照合が相対キーに一致しない）。起きない場合を説明するコメント付きの
死んだ分岐だったので削除した。

## 範囲外（上流 mulmoclaude 側）

- View の dispatch に `root` を載せる（mulmoclaude#3014）。入れば相対形式でも通るようになるが、
  この修正はそれを待たない。
- 保存失敗が Edit タブに出ずコンソールだけな点。入力欄に値が残るので保存されたように見える。

## 検証

- **実サーバで修正前後を測る**。修正前に `File not found` だった `updateScript` / `beatImage` が
  `ok: true` になり、ファイルの中身が実際に変わることまで確認する。
- 既存 spec のうち 9 件は旧規則（root 相対を優先）を固定しているので、新規則に書き直す。
  **既定 stories 配下の難所**（ワークスペースが `/`、末尾が空白、symlink の両綴り）は
  そのまま残すことが肝。動くのは root 配下の綴りだけ。
- **新規則を break-verify する**: canonical 綴りの mint を元（ペインの綴り）に戻すと 2 件、
  最長 tail 優先に反転すると 1 件が赤になることを実測する（mutation の前後で pristine 一致を確認）。
- `yarn format` → `lint` → `typecheck` → `build` → `test`。
