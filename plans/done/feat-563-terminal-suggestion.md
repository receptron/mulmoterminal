# feat #563 — Claude の候補（dim ゴーストテキスト）を画面と一緒にスマホへ渡す

## 問題

Claude Code は次の一手を入力欄に **dim（`ESC[2m`）のゴーストテキスト**として提示し、キーボードなら Tab で確定できる。実機の `tmux capture-pane -p -e`:

```
ESC[39m❯ ESC[2mmilestones に目標を書くESC[0m
```

`tmuxCapturePane` は `-e` なしで取っている（`server/infra/tmux.ts`）ため、mulmoserver（スマホ）に届く画面テキストでは

```
❯ milestones に目標を書く
```

としか見えない。**Claude の候補**と**ユーザーが打った文字**を区別する情報が消えており、スマホからは「文字が入っているのに送れない」状態になる。区別が要るのは、送信の意味が違うから:

- 候補（dim）: ホストの入力欄は実質空。ペーストすればそのまま正しく入る
- 実際に打った文字: ペーストは**追記**になるので、同じ文字列を送ると二重になる

つまり色を捨てている限り、スマホ側だけでは正しく実装できない。ホストが dim を読んで渡す。

## 変更

### 1. `server/session/screen-rows.ts`（新規・純粋関数）

画面を「1 行 = プレーンテキスト + その行の dim 部分」に正規化する。

```ts
export interface ScreenRow {
  text: string; // 行のプレーンテキスト
  dim: string; // その行の dim 属性が付いた部分（無ければ ""）
}

export const parseStyledRows = (styled: string): ScreenRow[];
export const rowsToScreen = (rows: readonly ScreenRow[]): string;
export const suggestionFromRows = (rows: readonly ScreenRow[]): string;
```

- `parseStyledRows` — `capture-pane -e` の出力を SGR / OSC で分割して走査する。tmux は `-e` で
  **SGR（`ESC[…m`）と OSC 8 ハイパーリンク**の両方を出す（実機の pane で確認済み）ので、どちらも
  テキストから外す。SGR のパラメータ走査は `38;5;N` / `38;2;R;G;B` の引数を読み飛ばす —
  さもないと色 `38;5;2` の末尾の `2` が dim 属性に化ける
- `suggestionFromRows` — プロンプト記号（`❯` / `>`）で始まり、**キャレット以降が丸ごと dim** の行を
  探し、最後の 1 つを採る。打った文字は dim にならないのでこの条件で落ちる。折り返しは、後続の
  「行全体が dim」の行を連結する（両端が ASCII の語なら空白を 1 つ入れる — 英語は折り返しで空白が
  消え、日本語は入れてはいけない）

### 2. `server/infra/tmux.ts`

`tmuxCapturePane` → `tmuxCaptureStyledPane`（`capture-pane -p -e`）。プレーン画面は
`rowsToScreen(parseStyledRows(...))` で再構成する。

### 3. `server/session/headlessScreen.ts`

`renderScreen` の戻り値を `string` → `ScreenRow[]` に。dim は `@xterm/headless` のセル属性
（`IBufferCell.isDim()`、`allowProposedApi` は既に有効）から読む。tmux 経路と headless 経路で
同じ `ScreenRow[]` を作るので、候補の判定ルールは 1 つで済む。

### 4. `server/backends/remoteHost/terminalScreen.ts` → 配線

`captureSessionScreen` の戻り値を `string` → `{ screen, suggestion }` に。
`getTerminalScreen` のレスポンスがそのまま `{ screen, suggestion }` になる（`handlers.ts`,
`remoteHost/index.ts`, `server/index.ts` の配線を追随）。候補が無ければ `suggestion: ""`。

## テスト

- `parseStyledRows` — SGR on/off、`ESC[0m` / `ESC[22m` によるリセット、`38;5;2` の誤検出、
  OSC 8 ハイパーリンク、エスケープ無しの行、空行
- `suggestionFromRows` — 実機のキャプチャ（候補あり / 空の入力欄 / 打ち込み済み / 権限プロンプト）、
  折り返し（日本語・英語）、キャレット以外の dim 行（差分の行番号など）を拾わないこと
- **golden**: 実 pane の `capture-pane -p` と `rowsToScreen(parseStyledRows(capture-pane -p -e))` が
  一致すること — 画面表示の互換が壊れていないことの担保
- `renderScreen` — 既存のテストを `ScreenRow[]` に追随。dim セルが `dim` に入ること

## スコープ外

- 画面そのものの色付け（receptron/mulmoserver#92）。`-e` 取得という土台はここで入るが、色の配信はしない
- スマホ側の UI（チップ表示、定型チップの常時表示、`ok` 追加）は receptron/mulmoserver#97
