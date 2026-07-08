# feat #258 — 起動時のディレクトリピッカーで使用中の dir を色で示す

新規セッション起動時、既に他セルでセッションが動いている dir のプリセットチップを色付けし、
二重起動や使用中の判別をしやすくする。

## 実装

既存の `openSessionIds`（`GridView` → `TerminalGrid` → `TerminalCell`）と同じ経路で
**`openCwds`**（セッション有りセルの cwd 一覧）を配線し、`TerminalCell` の起動フォームで
プリセットチップの path が `openCwds` に含まれれば色付け（●ドット + 青系 tint + ツールチップ）。

- `GridView`: `openCwds = state.cells.filter(c => c.session).map(c => c.cwd)`（null 除外）
- `TerminalGrid`: `openCwds: string[]` prop を中継
- `TerminalCell`: `openCwds?: string[]` prop、`runningCwds` Set、チップに `is-running` クラス + `.cell-chip-dot`

## 設計判断

- マッチングは path の**完全一致**（symlink / 末尾スラッシュの正規化は follow-up）
- 自セル（起動フォーム表示中はセッション未起動）は `openCwds`（session 有りセル由来）に入らず自然に除外
- 色は情報色（青系）。「注意」ではなく「使用中」の意味

## 非スコープ

- path の canonicalize
- 単一ビュー側の起動導線（本 UI はグリッドセルのランチャー）
