# feat: セルヘッダに GitHub を開くボタン

作成日: 2026-06-22

## User Prompt

- いま、dir名をクリックするとdirが開くけど、githubボタンを追加してgithubも開きたい。githubで管理している場合。
- ひょっとしたら top/issue/pr が開けるとよいかも。

## ゴール

グリッド表示のセルヘッダで、cwd が GitHub 管理下のリポジトリのとき、GitHub を開くボタンを追加する。
ボタンから **リポジトリ top / Issues / Pull requests** を開けるようにする。

## 現状

- セルヘッダ（`TerminalCell.vue`）の dir 名ボタンが `POST /api/open-dir` を叩き、OS のファイルマネージャで dir を開く（`server/open-dir.ts`）。
- 単一表示にはこの dir ボタンは無く、grid 専用。サーバに git 処理は未実装。

## 設計

### サーバ `server/gitRemote.ts`
- `parseGithubWebUrl(remoteUrl): string | null` — git remote URL を GitHub Web URL に変換する純関数（SSH scp 形式 / ssh:// / https:// / git:// 対応、github.com 以外は null）。単体テストしやすいよう純粋に保つ。
- `resolveGithubUrl(dir): Promise<string|null>` — `git -C <dir> config --get remote.origin.url` を spawn（シェル無し）して取得し、上記でパース。git 未導入 / 非 git / origin 無し / 非 GitHub は null。
- `mountGitRemoteRoute(app, { isAllowedOrigin })` — `POST /api/git-remote { path }` → `{ githubUrl }`。`open-dir` と同じ絶対パス検証 + 同一オリジンガード。

### フロント `TerminalCell.vue`
- `cwd` 変化（launch / サーバ確定 / 復元）を `watch(immediate)` し `/api/git-remote` を取得 → `githubUrl`。
- `githubUrl` があるとき dir 名の隣に GitHub アイコン（インライン SVG, `currentColor`）ボタンを表示。
- クリックで小さなポップオーバーを開き、**Repository / Issues / Pull requests** を `window.open`（`/issues`・`/pulls` はフロントで派生）。
- ポップオーバーは外側クリック / Escape で閉じる。`role=menu` は宣言せず素の button 群（矢印キー契約を過剰宣言しない）。

## 注意点
- GitHub URL は http(s) なのでブラウザの `window.open` で開く（dir はファイルマネージャ＝サーバ経由だが、URL はブラウザで開ける）。
- セキュリティ: `git` は固定コマンド、dir は `-C` で argv 渡し（シェル無し）、絶対パス + 実在検証。
- 配色はテーマトークン（`var(--…)`）で統一（テーマ機能 merge 済み）。

## 確認ポイント
- GitHub リポジトリの cwd でのみボタンが出るか（非 GitHub・非 git で出ないこと）。
- top / issues / pulls が正しい URL で開くか。
- 明/暗テーマでアイコン・ポップオーバーが判読できるか。
