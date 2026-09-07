# #1976 PR 1 — card identity を「ファイル」にする（ボタンはまだ出さない）

#1976 は「Files ペインの Canvas ボタンが stories ルート外の絶対パスのデッキに出ない」。
本体は **2 PR に切る**。これは 1 本目で、**identity だけ**を直す。issue はここでは閉じない。

- **PR 1（これ）** — card identity を正規化。`storyWirePath` のゲートは触らない
- **PR 2** — ゲートを緩めて root 外の絶対パスにも ref を mint する。**issue はそちらで閉じる**

順番が逆にできない理由: ボタンを先に出すと、1 つのデッキに 2 枚のカードが生まれる。
toolResults は `~/.mulmoterminal/toolresults` に永続する（`server/session/tool-store.ts`）ので、
割れたカードは履歴として残り、あとから identity を変えても
「設計上の互換性」ではなく「実際に割れて保存された履歴」が移行対象になる。
しかも割れた 2 枚は別々の綴りしか持たないので、あとから畳める保証がない。

## 直した欠陥（#1976 とは独立に、今日踏める）

card identity は `src/utils/canvasIdentity.ts` の `filePathIdentity` が決めていて、
**ワイヤの綴りそのもの**（`root\0filePath`）だった。ワイヤの綴りはファイルの性質ではなく
**「このサーバが何を登録しているか」の関数**なので、次の 2 つが起きる。純関数で再現を取った実測値:

**(B) preset を 1 つ足して再起動すると、同じファイルの identity が変わる**

```text
file = /Users/me/w/proj/decks/x.json
workspace のみ登録        → "W\0stories/proj/decks/x.json"
/Users/me/w/proj も登録   → "P\0stories/decks/x.json"
```

preset 追加の前後に作られたカードは 1 つのデッキで 2 枚になり、新しい方が古い方を supersede しない。

**(C) default root のカードにはパス成分が無い**

```text
/Users/me/w1/artifacts/stories/x.json → "stories/x.json"
/Users/me/w2/artifacts/stories/x.json → "stories/x.json"   ← 別ファイルが同一 identity
```

#1933 が named root について入れた守り（2 つの root の同名デッキを混ぜない）が、
default root には効いていなかった。

## 方針

**カードが持つ情報から canonical 絶対パスを組み立て、それを identity にする。**

`stories/<tail>` + root id は、root の canonical ディレクトリと繋げば絶対パスになる。
上の (B) はどちらの綴りも `/Users/me/w/proj/decks/x.json` に解決する。
これは **PR 2 で絶対パス指定で開いたときにサーバが返す綴り**でもあるので、
2 つの経路のカードが 1 枚に畳まれる — マイグレーションも二重キーも要らない。

解決できないカード（未登録の root、config 到着前、stories 以外の相対パス）は
**旧来の文字列にフォールバック**する。挙動は現状と同じなので後退しない。

## 変更点

- `server/backends/mulmoscript.ts` — `/api/config` の `storiesRoots[]` に **`canonical` を明示**。
  `paths` には canonical も入っているが**どれがそれかは印が無く**、位置も
  （symlink preset がマージされる経路で）一定しない。ブラウザは realpath できないので、
  どの綴りが解決済みかは**サーバしか言えない**。1 つの root を 2 つの綴りで解決すれば
  1 つのデッキが 2 枚になるため、推測ではなくラベルにする。
- `src/utils/canvasCardPath.ts`（新規・純関数）— ワイヤの綴り → 絶対パス。
  `dirPathKey` で正規化（`.` / `..` / 区切り / Windows）。
- `src/utils/canvasIdentity.ts` — `filePathIdentity(result, storyRoots)`。解決できなければ旧文字列。
- `src/plugins-registry.ts` / `src/components/GuiPanel.vue` — `identityOf` に root 表を渡す。
  `computed` なので config 到着で**再 collapse** される（カードの再送は不要）。
- `common/dirPathKey.ts` — `isRootedPath` を export（`rootOf` の重複定義を作らないため）。

## 限界

ブラウザは realpath できないので、**誰も解決していない綴りの中の symlink は畳めない**:

- root より下の symlink（`/root/link/x.json` と `/root/real/x.json` は別 identity のまま）
- **絶対パスの `filePath`**。プラグインは絶対パスを**呼び出し側が綴ったまま返す**
  （core の `locate` が `byPath` にその文字列をそのまま渡す。`resolveAbsoluteStory` は
  realpath を内部で使うが、返す card payload には載らない）。

root **の綴り**は解決できる。サーバが boot 時に realpath 済みで、それを `canonical` として
返すようにしたのがこの PR。実際に綴りが割れるのは主にそこ（launcher で打った綴り /
`git worktree list` の綴り）。

逃げ道は「正確な版」: `resolveStory` の realpath 済み `absolutePath` を card payload に載せて返す。
両側とも手元に値はある（こちらの `wirePathMismatch` も計算している）。今は入れない。

## 検証

- (B)(C) を**現行コードに対して**再現させてから直した（上の実測値）。
- 回帰テストは Files ペインの実チェーン（`storyWirePath` → card → `filePathIdentity`）を通す。
  片側だけでは欠陥が見えないため。
- 解決を無効化して**全部赤になること**を確認済み（identity 10 本、パネル 2 本）。
- **実サーバで確認**（`PORT=8899`、workspace を symlink 経由で起動、preset に `ws/proj`）:
  - `/api/config` が `canonical` を返し、それは `paths[0]`（launcher で打った symlink 綴り）ではない
    — 位置で拾う案が誤りだったことの実測。
  - プラグインの実レスポンス 4 通り（default root / root+tail / 絶対パス canonical / 絶対パス symlink）を
    identity にかけると、`root+tail` と `絶対パス canonical` が **1 つに畳まれる**。
    symlink 綴りだけ別 — 上記「限界」のとおり。
  - preset 追加前後の 2 つのワイヤ綴りが同じ identity に解決される（(B) の実機再現）。
  - 実際に保存された 2 枚の toolResult（`/api/agent/toolResults/:id` の中身）を実 config で解決 → 1 identity。
  - ビルド済みアプリをブラウザで読み込み: 描画される / uncaught console error なし。
  - Canvas ペインを実ブラウザで開くところまでは自動化できなかった（シェルセルの UI 操作が不安定）。
    表示の畳み込み自体は GuiPanel を**実コンポーネントとしてマウントする** spec で固定してある。
