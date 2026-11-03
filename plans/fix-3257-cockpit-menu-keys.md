# fix: コックピットの行メニューを矢印キーで巡れるようにする（#3257）

## 背景

拡大表示の一覧（コックピット）で各行の ⋮ から開くメニュー（`src/components/CockpitRowMenu.vue`）は
`role="menu"` と `role="menuitem"` を宣言しているのに、キー処理は Esc で閉じる窓のリスナーだけだった。
矢印キー・Home・End は何もせず、Tab は普通の頁と同じに焦点を外へ運ぶ。右クリックメニュー（#3256）が
同じ抜けを Codex に指摘されて直したとき、既存のこのメニューにも同じ抜けがあると添えられた。

## 方針

- 開いたら最初の有効な項目に焦点を移す（⋮ から開いても、行の右クリックから開いても）。
- パネルの `@keydown` で、他のメニューと同じ共通の補助関数 `menuFocusMove`（`filesRowActions.ts`）に任せる。
  矢印キーは端で折り返し、Home / End は端へ。無効な項目（動かせない方向）は飛ばす。Tab は閉じる。
- 閉じるとき、焦点がメニューの中にあれば ⋮ へ戻す（Esc・Tab・項目の選択・外側のクリック、どれでも）。
  `useAnchoredMenu` の `leave()` と同じ振る舞い。

## 仕様書

- `test/src/components/CockpitRowMenu.spec.ts`: 開くと最初の有効な項目に焦点があること。ArrowDown が無効な
  項目を飛ばすこと。End / Home / 折り返し。Tab で閉じて焦点が ⋮ に戻ること。Esc でも ⋮ に戻ること。

## 検証

`yarn format` → `yarn lint` → `yarn typecheck` → `yarn build` → 関連仕様。実機では、セルを拡大して一覧にし、
行の ⋮ を押してからキーだけで項目を巡り、Tab で閉じて焦点が ⋮ に戻ることを Playwright で確認する。
