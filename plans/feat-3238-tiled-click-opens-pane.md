# feat: タイル表示でもクリックしたファイルをそのセルの横のペインに開く（#3238 の分割 4）

## 背景

ターミナル出力のファイルパスをクリックすると、セルを拡大中（または既にペインがタイルの横に出ている）
ときはペインが先に受け取り、それ以外は新しいタブか Files ビューに行く。タイル表示でセルを拡大して
いないと、クリックは常に新しいタブに飛んでいた（`paneClickTarget.ts` の `roomForPane`）。

issue の目標の規則: **クリックしたファイルは、ペインが表示できる限りターミナルの横に開く。新しい
タブは、ペインが扱えないものと、利用者が明示的に選んだときだけ。**

## 方針

- タイル表示でリンクをクリックしたら、**そのセル**の横にペインを開いて表示する。再ルートの仕方は
  セルメニューの「Files」と同じ（`openPaneFor(uid, "files")`: `tiledPaneUid` をそのタイルにし、
  再ルートの監視がペインをそのディレクトリに置く）。ペインが別のタイルの横に出ていれば、セルメニュー
  と同じくそのタイルへ移る（移る前に、今のペインの未保存の編集を保存する）。
- クリック一つで画面の配置が変わるので、設定で切れるようにする。キーは `fileLinkOpensPane`、
  **既定は ON**。OFF にすると従来どおり: ペインが既にそのセルの横に出ているときだけペインに、
  それ以外は拡張子の経路（新しいタブ / Files ビュー）。
- 設定の持ち主は `mulmoterminal-keys`（選ぶだけでコピー・質問ペインと同じ「ターミナルでの操作」の
  設定）。Settings の「Terminal keys」に切り替えを置く。
- 拡大中の挙動は変えない: 拡大中のセルの横のペインが先に受け取り、他のセル（フィルムストリップ）
  からのクリックは従来どおり経路に行く。
- クリックの出所を知る必要がある。opener はこれまで `cwd` しか受け取らず、同じディレクトリのタイルが
  二つあると区別できなかった。リンクの配線（`terminalFileLinks.ts`）は接続を知っているので、
  セッション id を opener と右クリックメニューの要求に添える。グリッドはセッションからセルを探す。
- 保険: リンクの `cwd`（セッションの現在地）とセルが報告している `cwd` が食い違うとき（cd の直後など）
  は、ペインの根と相対パスが合わないので、横に開かず従来の判定に落とす。
- 再ルートは非同期（去るペインの保存を待つ）。ファイルは再ルートが終わってから開く。監視の各実行の
  終わりを数える `rerootSettled` を足し、`openPaneFor` のあと「ペインがそのセルに根付いた」か、
  または「監視の実行が一度終わった」まで待つ。保存できずにペインが動かなかったときは、セルメニューを
  押したときと同じく何も起きない（ペインは今の場所に残り、ヘッダがそのディレクトリを名指ししている）。

## 仕組み

- `server/config/app-config.ts`: `fileLinkOpensPane: boolean`（既定 true、`false` だけが OFF）。
  sanitize / mergeConfigUpdate / toPublicAppConfig。
- `src/composables/fileLinkOpensPane.ts`: `createGlobalFlag("fileLinkOpensPane", true)`。
  `useAppConfig.ts` で水を入れる。
- `src/components/settings/TerminalKeysSection.vue`: 切り替えを一つ。文言は
  `src/i18n/settingsControls/*.ts`（主要なロケールファイルは行数の上限にあるため）。
- `src/composables/filesPaneOpener.ts`: `FilesPaneOpener` と `tryOpenInPane` に `session` を足す。
- `src/composables/terminalFileLinks.ts`: `registerFilePathLinks(term, origin)`。`origin` は `cwd` と `session` を
  それぞれ返す関数を持つ一つのオブジェクト（`LinkOrigin`。呼び出し側の `useTerminalConnections.ts` が行数の上限に
  あり、引数を二つ足すと整形で複数行に割れるため）。`openInPane` と右クリックの要求
  （`LinkMenuRequest.session`）にセッションを添える。`useTerminalConnections.ts` は接続の `knownSessionId` を渡す。
- `src/composables/terminalLinkActions.ts`: `openLinkInPane` がセッションを opener に渡す。
- `src/components/paneClickTarget.ts`: `paneToOpenBeside(state, cell, cwd)` — タイル表示で、
  設定 ON で、クリックの出所のセルが分かり、そのセルの `cwd` がリンクの `cwd` と一致するとき、横に開く
  セルの uid を返す。それ以外は null。
- `src/components/TerminalGrid.vue`: `openClickedPath` が先に `paneToOpenBeside` を問い、uid が返れば
  `showClickedPathBeside(uid, …)`（`openPaneFor` → 再ルート待ち → `openFile`）。それ以外は従来の
  `paneCanShowClick`。

## 試験

- `paneClickTarget.spec.ts`: `paneToOpenBeside` の各条件（拡大中は null、設定 OFF は null、
  セル不明は null、cwd 不一致は null、揃えばそのセルの uid）。
- 新しい `gridClickOpensPane.spec.ts`（グリッドをタイルで組み、`openInFilesPane` を直接呼ぶ）:
  クリックしたタイルの横にペインが開きそのディレクトリに根付き、`openFile` が呼ばれ、拡大は要求
  されない。ペインが別のタイルの横にあれば移って開く（去るペインの保存を待ってから `openFile`）。
  設定 OFF なら false で何も開かない。拡大中は従来どおり。cwd 不一致は false。
- `app-config.spec.ts`: 既定 true、`false` だけが OFF、更新の持ち越し。`settings-coverage.spec.ts`
  に `fileLinkOpensPane: { ui: true, skill: "mulmoterminal-keys" }`。
- 配線: `terminalFileLinks.spec.ts`（要求にセッションが乗る）、`terminalLinkActions.spec.ts`、
  `TerminalLinkMenu.spec.ts`（opener の引数）。
- 実機: 使い捨ての HOME でサーバーを起動し、タイル表示（拡大なし）で `.md` のリンクをクリックして
  ペインがそのセルの横に開くこと、設定を OFF にすると新しいタブに行くことを確かめる。

## 文書

- README: 「Clicking a file path」の規則（ペインが先、タイル表示も）と設定表の `fileLinkOpensPane`。
- `docs/guide/{en,ja}/config.md`: skill の表、Settings の表、節、キーの表。
- `docs/guide/{en,ja}/features.md`: ファイルパスのリンク化の行。
- `docs/file-surfaces.md`: 右ペインの行（誰がパスを選んだか）と再ルートの段落。
- `docs/grid-view-modes.md`: 右ペインの節（クリックもタイルの横に開く）。
- `docs/terminal-notes.md`: ローカルパスの行の「ペインが受け取る条件」。
- `server/skills/mulmoterminal-keys/SKILL.md`: 症状の表と `fileLinkOpensPane` の節。
