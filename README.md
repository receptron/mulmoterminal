# mulmoterminal

Claude Code の対話モードをブラウザで動かす Web ターミナル。

`-p` (headless) モードや Agent SDK を使わず、node-pty で本物の TTY を確保して Claude Code を起動し、WebSocket + xterm.js でブラウザに中継します。

## How it works

### なぜ node-pty が必要か

Claude Code の対話モードは [Ink](https://github.com/vadimdemedes/ink)（React ベースの TUI フレームワーク）で画面を描画します。Ink は **TTY（端末デバイス）** が接続されていることを前提としており、通常の `child_process.spawn()` では TTY が提供されないため、対話モードは起動しません（stdout に何も出力されず沈黙する）。

[node-pty](https://github.com/microsoft/node-pty) は **擬似端末 (pseudo-TTY)** を作成するネイティブモジュールです。OS のカーネルレベルで本物の TTY デバイスを割り当てるため、Claude Code から見ると人間がターミナルで操作しているのと同じ環境になります。

### データの流れ

```
┌─────────────────────────────────────────────────────────┐
│ Browser                                                 │
│                                                         │
│  xterm.js (Terminal emulator)                           │
│    ├─ onData(key) ──→ WS send {type:"input", data}     │
│    └─ write(data)  ←── WS recv {type:"output", data}   │
│         ↕                                               │
│    WebSocket (ws://localhost:5173/ws)                    │
│         │  Vite dev server が localhost:3456 に proxy    │
└─────────┼───────────────────────────────────────────────┘
          │
┌─────────┼───────────────────────────────────────────────┐
│ Express │ (port 3456)                                   │
│         ↕                                               │
│    WebSocketServer (/ws)                                │
│         ↕                                               │
│    node-pty                                             │
│    ├─ pty.spawn("claude")  ← 擬似 TTY を割り当てて起動  │
│    ├─ term.onData(data) ──→ ws.send() ──→ ブラウザへ    │
│    └─ term.write(key)   ←── ws.recv() ←── ブラウザから  │
│         ↕                                               │
│    Claude Code (対話モード)                              │
│    ├─ Ink TUI が TTY に描画 (ANSI エスケープ付き)        │
│    └─ stdin からキー入力を読み取り                       │
└─────────────────────────────────────────────────────────┘
```

1. **ブラウザ**: xterm.js がターミナルエミュレータとして動作。ユーザーのキー入力を WebSocket で送信し、受信した ANSI エスケープシーケンスをそのまま描画
2. **Express サーバー**: WebSocket 接続を受けると `node-pty.spawn("claude")` で Claude Code を起動。PTY の出力をそのまま WebSocket に流し、WebSocket からの入力をそのまま PTY に書き込む
3. **Claude Code**: 本物の TTY が接続されているため、通常の対話モードとして起動。Ink の TUI 描画、カーソル移動、色付け、ツール承認プロンプトなどが全て正常に動作

### macOS での注意点

node-pty の npm パッケージに含まれる `spawn-helper` バイナリは実行権限なし (644) で配布されており、macOS で `posix_spawnp failed` エラーを引き起こします。`postinstall` スクリプトで自動的に 755 に修正します。

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
yarn install
yarn dev
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
| `yarn dev` | Vite + Express を同時起動 (開発用) |
| `yarn build` | フロントエンドをビルド |
| `yarn server` | Express のみ起動 (dist/ を配信) |
| `yarn lint` | ESLint |
| `yarn typecheck` | TypeScript 型チェック |
