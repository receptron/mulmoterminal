# mulmoterminal

Claude Code の対話モードをブラウザで動かす Web ターミナル。

`-p` (headless) モードや Agent SDK を使わず、node-pty で本物の TTY を確保して Claude Code を起動し、WebSocket + xterm.js でブラウザに中継します。

## Architecture

```
Express (Node.js)
  └─ node-pty.spawn("claude")   ← 本物の PTY で対話モード起動
       ↕ WebSocket
Browser
  └─ xterm.js (Vue 3)           ← TUI をそのまま描画
```

## Setup

```bash
npm install
npm run dev
```

ブラウザで http://localhost:5173 を開く。

## Requirements

- Node.js 22+
- Claude Code CLI (`claude`) がインストール済み
- macOS (node-pty の spawn-helper 権限は postinstall で自動修正)

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3456` | Express サーバーのポート |
| `CLAUDE_BIN` | `claude` | Claude CLI のパス |
| `CLAUDE_CWD` | `$HOME` | Claude の作業ディレクトリ |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Vite + Express を同時起動 (開発用) |
| `npm run build` | フロントエンドをビルド |
| `npm run server` | Express のみ起動 (dist/ を配信) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript 型チェック |
