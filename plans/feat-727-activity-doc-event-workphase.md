# feat #727 — セッション活動 doc に event と workPhase を載せる

## やりたいこと

Firestore のセッション活動 doc（#439）に `event` と `workPhase` を載せ、mulmoserver（スマホ側,
receptron/mulmoserver#99）が cockpit/grid と同じ状態語彙（`blocked` / `done` / `editing` /
`planning` / `working` / `idle`）を出せるようにする。

## 調査で分かった前提（issue の想定との差分）

- **`event`**: publish 時点で既に手元にある。`Activity` / `sessionRow` が持ち、`publishActivity`
  （`server/session/lifecycle.ts`）が `row.event` として参照できる。→ そのまま渡すだけ。
- **`workPhase`**: **publish 時点ではメモリに無い**。`classifyWorkPhase(現ターンのツール名)` は
  transcript を読む `readSessionSummary`（`session-reads.ts:155`）でのみ算出され、roster の
  `/api/session/:id` だけが使う。publish は同期 hook 経路上の fire-and-forget なので、そこで
  transcript を読むのは既存設計に反する（読んではいけない）。
  → **hook 経路で live に追跡する仕組みを新設**する。

## 設計

### 1. live work-phase トラッカー（新規・純粋）

`server/session/work-phase-tracker.ts`（純関数 + 小さな状態）:

transcript 版 `currentTurnToolNamesFromParsed` のターン境界ルールを hook イベントに写す:

- `UserPromptSubmit` → 新しいターン開始（ツール名リセット）
- `PreToolUse` の `tool_name` → 現ターンのツール名として蓄積
- 判定は既存の `classifyWorkPhase`（`workPhase.ts`）をそのまま再利用（roster と同じ意味論）

純粋な遷移関数として書き、セッションごとの Map は薄いラッパに閉じる:

```ts
export function nextTurnTools(prev: string[], event: string, toolName?: string): string[]
export function createWorkPhaseTracker() // note(id, event, toolName) / phaseOf(id) / forget(id)
```

### 2. doc に 2 フィールド追加（後方互換, optional）

`server/backends/remoteHost/sessionActivity.ts`:

```ts
export interface SessionActivity {
  working: boolean;
  waiting: boolean;
  event?: string | null;        // waiting を立てた hook（Notification / Stop など）
  workPhase?: WorkPhase | null; // planning | implementing
}
```

`stateKey` にも 2 つを含める（working/waiting が同じでも event / workPhase が変われば書く。
逆に無関係な再 publish は従来どおり抑制）。

### 3. 配線

- `lifecycle.ts` の `publishActivity`: `sessionActivityPublisher.publish(id, { working, waiting,
  event: row.event, workPhase })` へ。`workPhase` は deps 経由の getter（`workPhaseOf(id)`）で
  取得し、lifecycle は tracker を知らない。
- `hook-routes.ts`: activity hook で `deps.noteWorkPhase(sessionId, event, tool_name)` を呼ぶ。
- `index.ts`: tracker を生成して両者に配線。`reap` 時に `forget`。

## テスト

- `work-phase-tracker`: ターンリセット / mutation → implementing / 読みのみ → planning /
  ツール無し → null / 別セッション独立 / forget。
- `sessionActivity` publisher: event だけ変わった場合に書く / workPhase だけ変わった場合に書く /
  3 つとも同じなら書かない（dedup 維持）/ payload に両フィールドが載る。
- `lifecycle`: publish に event と workPhase が渡る。

## 確認事項（レビュー観点）

- workPhase の live 算出は hook 由来（PreToolUse）で、roster の transcript 由来と**独立**。
  同じ `classifyWorkPhase` を共有するので語彙は一致するが、境界条件（サーバ再起動直後、hook を
  取りこぼした場合）では roster と一時的にズレうる。null に degrade する設計。
- `stateKey` に 2 フィールドを足すことで、従来より write 回数が増えるケースがある
  （working/waiting 据え置きで workPhase だけ planning→implementing に動く等）。意図どおり
  （スマホがその遷移を表示するため）だが Firestore の write 量に影響する。
