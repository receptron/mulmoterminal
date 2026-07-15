# feat: グリッドでヘッダー背景クリックでも zoom してアクティブに（#378）

Issue: #378 / Branch: `feat/header-click-zoom`

## User Prompt

- grid view の expand してない状態で、terminal の body 部分をクリックすると terminal が切り替わる（アクティブになる）けど、header は切り替わらない。
- （明確化）body と同じように header をクリックしてもそのターミナルが zoom してアクティブになるようにしてほしい。

## 現状と変更

現状 `src/components/cellHeaderZoom.ts` の `shouldZoomOnHeaderClick(target, filmstrip)` は `!filmstrip` なら常に `false` ＝ タイル表示（通常グリッド）ではヘッダー背景クリックは無反応で、右上の ⤢ ボタンでしか zoom できなかった。

これを「**expand していないセルなら、ヘッダー背景（ボタン以外）クリックで zoom（`toggle-expand`）**」に変更:

- 第2引数を `filmstrip` → `expanded` に。`if (expanded) return false;`（expand 中のセル自体は誤操作 restore 防止で据え置き。restore は ⤡ ボタン）、それ以外は従来どおりボタン以外なら `true`。
- タイル表示・フィルムストリップ両方でヘッダー背景クリックが zoom（＝そのターミナルへ切替＝アクティブ）。ヘッダー内のボタン（dir / GitHub / diff / ⤢ / ✕ / ◀▶）は従来動作を維持（`closest("button")` で除外）。
- `is-zoomable`（ポインタカーソル＋hover 背景）も `filmstrip` → `!expanded` に。クリック可能な afford を通常グリッドでも表示。
- TerminalCell / CommandCell / LauncherCell 共通（`shouldZoomOnHeaderClick(event.target, props.expanded)`）。CommandCell/LauncherCell は未使用になった `filmstrip` computed を削除。

## テスト

- `cellHeaderZoom.spec.ts`: `expanded=false` で zoom / `expanded=true` で非 zoom / ボタン(SVG含む)除外 に更新。
- 各 cell の spec: 「通常グリッドで zoom する」「expand 中は zoom しない（⤡ で restore）」「フィルムストリップで zoom」。
- `yarn lint`（0 error）/ `yarn build` / `yarn test`（1150 パス）。

## 対象外

- expand 中のセルのヘッダークリックで restore する挙動は今回入れない（据え置き）。
