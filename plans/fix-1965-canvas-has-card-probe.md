# #1965 — `[Mulmo]` から選んだデッキが "Canvas is not enabled for this session" に隠れる

## 症状

render MCP を持たないセル（`/api/tools` の `groups` が `[]`）を拡大した状態で、ヘッダーの
`[Mulmo]` メニューからデッキを選ぶと、Canvas ペインが "Canvas is not enabled for this session"
を出してデッキが表示されない。カード自体はサーバに保存されており、縮小→再拡大すると出る。

## 原因

`canvasHasCard`（`src/components/TerminalGrid.vue`）は **キャッシュ**で、
`[expandedSessionId, expandedUid]` の watch が拡大のたびに `hasStoredCard()` で取り直す。

- Files ペイン経路（`openFileInCanvas`）は seed の直後に自分で `canvasHasCard.value = true` を立てる
- `[Mulmo]` メニュー経路は `Terminal.vue` の `onDeck` が seed してから `emit("canvas")` を出し、
  grid 側は `openCanvasFor(cell.uid)` を呼ぶだけ。**フラグに触れない**

セルが既に拡大済みだと `expandedUid` も `expandedSessionId` も変わらないので watch も走らず、
`canvasHasCard` は seed より前に取った `false` のまま残る。`canvasUnavailable` は
`canvasChecked && !(canvasAvailable || canvasHasCard)` なので "no-canvas-mcp" を出す。

## 直し方 — 経路ごとにフラグを立てるのではなく、`openCanvasFor` が取り直す

issue が挙げた 2 案のうち後者。**クラスを直す**形にする:

- 立て忘れの余地が無くなる。同じ形の経路は `[Mulmo]` だけではなく、GridView が
  `defineExpose({ openCanvasFor })` 越しに呼ぶ「seed 済みの chat を置く」経路もある
- ストアが権威。seed の POST は `storeToolResult` を await してから 200 を返すので、
  直後の GET は必ずそのカードを見る（`server/routes/tool-routes.ts:102-127`）。
  しかも POST は **落とされたカード**（`stored === false`）でも 200 を返すので、
  手で立てるフラグは「あるはずのカード」を主張し得る

取り直しは **ペインが "no-canvas-mcp" を出す条件のときだけ**走らせる:
`expandedUid === uid && session あり && !canvasAvailable && !canvasHasCard`。
render MCP を持つ通常のセルでは 1 往復も増えない。

`openFileInCanvas` の `canvasHasCard.value = true` は**残す**。あちらは「いま自分が書いた」と
知っている側で、往復が要らないうえ、probe が失敗（ネットワーク）しても正しい。二重ではなく、
「知っている側は言う / 知らない側は訊く」の 2 つ。

## テスト

`test/src/components/TerminalGrid.spec.ts` の `describe("open-in-canvas")` に、
`TerminalCell` の `canvas` イベント経由の同型ケースを足す:

- `/api/tools` は `groups: []`（render MCP 無し）
- ストアは seed の**後**にだけカードを返す
- 拡大済みのセルで `canvas` を emit → `GuiPanel` の `unavailable` prop が `null` になる

壊して確認: probe を外すと `unavailable === "no-canvas-mcp"` で赤になる。
