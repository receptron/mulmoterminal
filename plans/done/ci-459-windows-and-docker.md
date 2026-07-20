# ci: Windows daily + Docker sandbox CI

Issue: #459

## 背景

mulmoterminal の CI は `ci.yml` の **ubuntu-latest / Node 22 のみ**で、matrix が無い。
そのため次の 2 つが一度も CI で実行されていない。

1. **Windows のコードパス**。`server/infra/pty-env.ts` は `Path` のケーシング差、`;` デリミタ、
   `\` セパレータを扱い、`server/index.ts` は Windows で `powershell.exe` を spawn する。
   いずれも Windows 上で走ったことがない。
2. **`Dockerfile.sandbox` のビルド**。CI で一度も build されていない。しかもこの Dockerfile は
   意図的に何もピン留めしていない（"Pin nothing here — a rebuild picks up the latest"）ため、
   ベースイメージ更新・apt パッケージ改名・`npm install -g @anthropic-ai/claude-code` の失敗で
   静かに壊れる。壊れても macOS ユーザーが実行時に初めて気づく。

## 設計上の前提（コードを読んで確認した事実）

`server/index.ts:2338` のゲート:

```ts
const sandbox = sandboxEnabled() && sandboxPlatformSupported() && attachGuiMcp && ws !== null && dockerAvailable() && sandboxImageExists();
```

`sandboxPlatformSupported()` は `process.platform === "darwin"` のみ true（`server/infra/sandbox.ts`）。
`&&` の短絡により **Windows では `dockerAvailable()` が probe すらされない**。

したがって「Docker on Windows」を動かしても、製品側にそれを使う経路は無い。Windows×Docker ジョブで
検証できるのは次の 2 点であって、コンテナ実行経路そのものではない。

- **Windows チェックアウトから `Dockerfile.sandbox` がビルドできること**。リポジトリに
  `.gitattributes` が無いため、git-for-windows の既定（`core.autocrlf=true`）でテキストファイルは
  CRLF に変換される。CRLF は Dockerfile の行継続やシェルスクリプトの shebang を壊す既知の罠であり、
  **これは Windows でしか検出できない実際の回帰リスク**。
- 将来 Windows sandbox を有効化する際の WSL2 足場が動作すること。

## 追加するもの

### 1. `.github/workflows/windows-daily.yaml`

`windows-latest` / Node 22.x・24.x の matrix で、`ci.yml` と同じゲート
（lint / typecheck / typecheck:server / build / test）を回す。

トリガは **daily cron + workflow_dispatch + main への push**（PR ごとには回さない）。
Windows runner は遅く、PR CI の待ち時間を増やす価値が無いため。

Windows 固有の実装ノウハウ（mulmoclaude の `lint_test_windows.yaml` から採用）:

- **Defender のリアルタイム保護を切る** — `yarn install` の atomic rename が EPERM になる
- **`setup-node` の `cache: yarn` を使わず `actions/cache` で `node_modules` を持つ** — NTFS 上の
  tar 展開が fresh install より遅い
- **Puppeteer キャッシュを install 前に復元** — `puppeteer` は直依存で、postinstall が ~120MB 落とす

mulmoclaude 固有で**移植しない**もの: `build:packages`（monorepo でない）、`plugins:codegen:check`、
`test:coverage`（このリポジトリの runner は vitest）、`test:csrf-wiring`、committed esbuild バンドルの
`git diff` チェック（該当パスが無い）。

要注意点として、このリポジトリには mulmoclaude に無い `postinstall`
（`node server/fix-pty-perms.js` — node-pty の spawn-helper chmod）がある。Windows で無害に通ることを
このジョブ自体が検証することになる。

### 2. `.github/workflows/docker-sandbox.yaml`（ubuntu）

`Dockerfile.sandbox` を実ビルドし、コンテナ内を検証する。

- `claude --version` が動く（`npm install -g @anthropic-ai/claude-code` が生きている）
- `git` / `curl` / `rg` / `ca-certificates` が入っている（claude の内蔵ツールの前提）
- 非 root（uid 1000）で動く
- `HOME=/home/node`、`WORKDIR=/home/node/workspace`

さらに `scripts/ci-sandbox-image.ts` で**実際の `ensureSandboxImage()` を実行**し、キャッシュ契約を
e2e で検証する:

1. 1 回目の呼び出しでイメージができる
2. イメージのラベル `mulmoterminal.dockerfile.sha256` が `Dockerfile.sandbox` の sha256 と一致する
3. 変更なしの 2 回目は再ビルドせず true を返す（イメージ ID が変わらない）
4. **Dockerfile を変更すると再ビルドされ、ラベルが更新される**（この分岐が本命）

トリガは daily cron + workflow_dispatch + `Dockerfile.sandbox` / `server/infra/sandbox.ts` /
このワークフロー自身が変わった PR・push。

### 3. `.github/workflows/docker-sandbox-windows.yaml`（Windows × WSL2）

`windows-latest` には Windows コンテナ用の Docker しか無く、Docker Desktop は初回起動に UI を要する。
そのため mulmoclaude と同じ WSL2 手法を使う: `wsl --install -d Ubuntu-22.04 --no-launch` →
`apt-get install docker.io` → `dockerd --iptables=false --bridge=none` をヘッドレス起動
（WSL2 のカーネルに `iptables_nat` が無いため）→ `docker info` を polling。

その上で **Windows チェックアウトのまま**（＝ CRLF 変換された可能性のあるファイルで）
`Dockerfile.sandbox` を WSL2 内でビルドし、ubuntu ジョブと同じスモークを流す。
パス変換は `C:\...` → `/mnt/c/...`。

daily cron + workflow_dispatch のみ。WSL2 セットアップに時間がかかり不安定なため、PR には出さない。

## コード変更

`sandboxPlatformSupported()` に省略可能な `platform` 引数を足し、テスト可能にする。

```ts
export function sandboxPlatformSupported(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin";
}
```

現状この関数は**テストが 1 つも無い**。引数化することで、`process.platform` をモックせずに
「darwin のみ true」を明示的に固定できる。Linux / Windows を意図せず有効化する変更が入れば
テストが落ちる（`server/infra/sandbox.ts` のコメントが述べる uid マッピング未対応・パス非互換の
前提を、コメントではなくテストで守る）。

呼び出し側は無変更。

## テスト

`test/server/infra/sandbox.spec.ts` に `sandboxPlatformSupported` の parameterized テストを追加
（darwin → true、win32 / linux / freebsd → false、引数省略時は実プラットフォームに一致）。

イメージのスモークは vitest ではなく CI 側で行う（Docker を要するため）。

## スコープ外

- macOS runner の追加。#459 では「安い最初の一歩」として挙げたが、本 PR は Windows と Docker に絞る。
- Windows での sandbox 有効化そのもの。ゲートは `darwin` のみのままで、本 PR は変更しない。
