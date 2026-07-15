# feat: ヘッダーに Skill メニューを追加（.claude/skills を実行）（#363）

Issue: #363 / Branch: `feat/header-skill-menu`

## User Prompt

- グリッドで run（`▶ Run ▾`）でいろいろ実行できるけど、skill も同様にヘッダーに追加して実行できるようにしたい。spec はほぼ run と同じで良い。
- スキルを選んだときの実行は **今のセッションに送信**（`/<slug>` を打ち込んで実行。run の `input` ボタンと同じ経路）。
- 優先度（並び順）は **working dir（project）のスキルを先**にしたい。
- 設定（`.mulmoterminal.json`）で絞り込み、設定がなければすべて出す。

## 概要

`RunMenu`（`▶ Run ▾`）と対になる `SkillMenu`（`⚡ Skill ▾`）をターミナル・ヘッダーに追加する。run が
`script.json` の shell コマンドを別（spare）セルで起こすのに対し、skill は **その場のエージェント
セッションで走る**（`/<slug>` を `submitText` で投入。Claude はスラッシュコマンド、Codex は
`Use the "<slug>" skill.` に言い換え）。一覧のソースは run と同じく cwd 基準で自動走査する。

## 設計判断

- **配置**: `runMenu` prop で出す（単一ビュー＋グリッド各セル）。RunMenu と全く同じ場所。スキルが
  1件も無ければボタン非表示（`script.json` が無いと Run が出ないのと同じ）。
- **一覧ソース**: 既存の `server/backends/remoteHost/skills.ts` を再利用。`discoverSkillNames`（id のみ、
  remote-host 用）は温存し、説明文つきの `discoverSkills`（`{slug, description}[]`）を追加。
- **並び順**: `discoverSkills` を **project 優先**に変更（project スコープを先頭、その後 user スコープ、
  各グループ内 slug 昇順、同名は project が上書き）。`discoverSkillNames` は remote-host の従来仕様
  維持のためアルファベット順に再ソート。
- **実行**: skill は現在セッションに投入するため、command cell 経路（`/ws/run`）は使わない。
  `SkillMenu` は `skill`(slug) を emit → `Terminal.vue` が `conn.submitText(slotKey, skillSeed(slug, codex))`。
  `skillSeed` は純関数（Claude→`/<slug>`、Codex→`Use the "<slug>" skill.`。サーバの `codexifySkillSeed`
  のクライアント版）。
- **絞り込み**: 設定は per-dir `.mulmoterminal.json`。`skills: ["<slug>", …]` の許可リスト（並び順も兼ねる）。
  無ければ全表示（＝「設定がなければすべて出す」）。`config-schema.ts` に `dirSkillsField`（trim/重複除去/
  最大100件、空・不正は null＝全表示）と strict スキーマの `skills` を追加。`dir-config.ts` の
  `loadDirConfig` で読み、`/api/skills` で `applySkillFilter` を適用。存在しない slug は無視。

## 変更ファイル

- `server/backends/remoteHost/skills.ts` — `DiscoveredSkill`, `discoverSkills`(project 優先),
  `applySkillFilter`, `discoverSkillNames`(alpha 維持)。
- `server/config-schema.ts` — `dirSkillsField`, `MAX_SKILL_FILTER`, `writableDirConfigSchema.skills`。
- `server/dir-config.ts` — `DirConfig.skills` / `loadDirConfig` で読み込み。
- `server/index.ts` — `GET /api/skills`（project 優先＋`.mulmoterminal.json` 絞り込み）。
- `src/components/SkillMenu.vue` — RunMenu を踏襲した `⚡ Skill ▾`。
- `src/components/skillSeed.ts` — Claude/Codex のシード文（純関数）。
- `src/components/Terminal.vue` — SkillMenu 配置＋`onSkill`。
- `server/skills/mulmoterminal-config/SKILL.md`, `README.md` — ドキュメント。
- テスト: `SkillMenu.spec.ts`, `skillSeed.spec.ts`, `skills.spec.ts`, `dir-config.spec.ts`,
  `config-schema.spec.ts`。

## 検証

- `yarn format` / `yarn lint`（0 error）/ `yarn typecheck:server`（クリーン）/ `yarn build` /
  `yarn test`（全パス）。
- ライブ: `/api/skills` で project 優先の並びと `.mulmoterminal.json` の `skills` 絞り込みを確認。

## メモ（本 PR の範囲外）

- 一覧には `schema.json` を持つ collection の SKILL.md も含まれる（Claude が見るのと同じ）。除外は将来対応可。
- 起動不良の別件（`@mulmoclaude/core` が node_modules で 0.12.1 のまま＝要 `yarn install`）は本 PR と無関係。
