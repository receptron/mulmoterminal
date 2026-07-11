# feat — `.mulmoterminal.json` を skill で生成・一括設定する

Issue: #296

## Problem

`.mulmoterminal.json`（per-dir 設定）は表現力が高い一方、手で書くのが大変:

- 色が 8 種（`badgeColor` / `headerColor` / `headerTextColor` / `cellColor` / `cellBorderColor` / `dotColor` /
  `buttonColor`）＋ `colors`（xterm ITheme 23 キー）＋ `theme`。
- `buttons` / `chips` は `run` 種別・`open` ターゲット・`${var}` 置換・`when` DSL を持つミニ言語。

対話的に生成・編集できる skill でこれをサポートする。

## Goals（ユーザー確定）

1. **mulmoterminal から呼び出せる**（アプリ内の導線から起動）。
2. **npx 配布物でも使える**（同梱＋起動時設置）。
3. **今の端末だけでなく、起動履歴の複数 dir をまとめて設定できる** —
   「起動履歴」＝新規 terminal ランチャと同じ `cwdPresets`。まとめて設定＝対象 dir を明示的に
   ユーザーに聞き、**全部 or 個別**に適用。

## 設計判断（ユーザー回答）

- **配置**: ユーザーグローバル `~/.claude/skills/mulmoterminal-config/`。起動時に所有マーカー付きで
  設置（自分のものだけ更新・ユーザーの同名 skill は絶対に触らない）、best-effort（起動を止めない）、
  opt-out env。codex にも同じ流儀で `~/.codex/skills/` へミラー。既存 `server/codex-skills.ts` の
  `.mt-mirror` マーカー方式を踏襲。
- **対象 dir**: `~/.mulmoterminal/config.json` の `cwdPresets`（`{ label, path }[]`）を読む。
- **範囲**: フル（name / 色一式 / `colors` / `theme` / `buttons` / `chips`）。

## スキーマ（skill が守る正、`server/dir-config.ts` + `server/header-config.ts` 準拠）

- 文字列色（`badgeColor` 等 7 つ）: `#rrggbb` のみ。
- `colors`: ITheme キー（`foreground` `background` `cursor` `cursorAccent` `selectionBackground` …
  ANSI16 `black`…`brightWhite`）。値は `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa`。未知キーは捨てられる。
- `theme`: `"midnight" | "nord" | "daylight" | "solarized"`（**注: `solarized-light` ではない**）。
- `name`: 40 文字まで。
- `sound`: cwd 内の相対パスのみ（絶対・`../` は拒否）。
- `buttons[]`（最大 32）: `{ id, label, run, emoji?, icon?, when?, order?, ... }`。
  - `run: "shell"` → `cmd` 必須。`run: "input"` → `text` 必須。`run: "open"` → `open` 必須。
  - `open`: `url`(http/https) / `reveal`(dir→OS ファイルマネージャ) / `files`(アプリ内) /
    `view`(`diff|prs|wiki|collections|accounting`)。
- `chips[]`（最大 16）: 組み込み文字列（`dir` `git` `ctx` `usage` `status` `diff` `tools`）
  または `{ label, text, when? }`。`chips` 省略時は既定チップ。
- `${var}`: `dir` `dirName` `branch` `repo` `model` `agent` `session` `remoteUrl` `dirty` `ahead` `behind` `task`。
- `when` DSL: 原子 = `isGitRepo` / `!isGitRepo` / `key == v` / `key != v`。結合 = `&&`（優先）/ `||`。括弧なし。

## Phases（各 PR）

### Phase 0 — 設定全体を zod 化（skill の土台）
DSL だけでなく **設定全体**を zod で一元定義する（ユーザー判断）。

- 新規 `server/config-schema.ts`: 単一の正。
  - 共有サブスキーマ: `hexColor` / `paletteColor` / `themeId` / `openTarget` / `headerButton`（run で payload 分岐）/ `headerChip`（builtin enum | custom）。
  - per-dir `dirConfigSchema`（name/色一式/colors/theme/sound/buttons/chips）。
  - global `appConfigSchema`（cwdPresets/launchers/prRepos/userMcpServers/buttons/chips）。
  - 型は全て `z.infer`（`DirConfig` / `AppConfig` / `HeaderButton` / `HeaderChip` / `CwdPreset` … の重複定義を置換）。
- **保持すべき挙動（回帰厳禁）**:
  1. 寛容さ — 各フィールドに `.catch(fallback)`（zod v4）で「不正フィールドは捨てて null/drop、throw しない」。
     `chips: null`（未設定＝既定）と `[]`（設定済み空）の区別を維持。ファイル破損＝全 null（`safeParse` 失敗時 EMPTY）。
  2. セキュリティ — `sound` の cwd 内 realpath 確認は **zod 内に入れず parse 後の専用ステップ**（`resolveDirSound` を維持）。
- `dir-config.ts` / `header-config.ts` / `app-config.ts` / `cwd-presets.ts` は schema を使うよう置換し、
  **公開 API（`loadDirConfig` / `publicDirConfig` / `sanitizeButtons` / `loadPresets` …）のシグネチャは維持**して呼び出し側を壊さない。
- JSON Schema: `z.toJSONSchema(dirConfigSchema)` を skill に同梱（Phase 1 で参照）。
- 既存 spec（`header-config.spec.ts` / `header-resolve.spec.ts` ほか）を緑のまま維持＋ `config-schema.spec.ts` 追加。

### Phase 1 — skill 本体＋配布
- `server/skills/mulmoterminal-config/SKILL.md`（frontmatter＋手順）＋ `reference.md`（上記スキーマ全文）。
- `server/install-config-skill.ts`: 同梱ソースを `~/.claude/skills` と `~/.codex/skills` へ設置。
  マーカー方式（`server/codex-skills.ts` の generic 化 or 専用ヘルパ）。opt-out `MULMOTERMINAL_NO_SKILL_INSTALL`。
- `server/index.ts` の boot に best-effort で配線（`initWorkspaceSetup` 付近）。
- `files` は `server/` を既に含むので同梱 OK（.md ごと出荷）。
- テスト: `server/install-config-skill.spec.ts`（設置 / 自分のマーカーは再設置 / ユーザー同名は skip）。
- 成果: どの端末でも `/mulmoterminal-config` で**今の dir** を設定できる。

### Phase 2 — まとめて設定
- skill が `~/.mulmoterminal/config.json` の `cwdPresets` を読み、対象 dir を提示・確認して
  全部/個別に適用（主に skill 内容。サーバ変更は最小/不要）。

### Phase 3 — UI 呼び出し口
- セルヘッダ「このターミナルを設定」＋ツールバー「まとめて設定…」から、既存 seed 経路
  （`/mulmoterminal-config …`、codex は `codexifySkillSeed`）で起動。

## 付随（別対応で報告）

ドキュメントの `theme` 値バグ: `docs/guide/{ja,en}/config.md` が `solarized-light` と記載。正は `solarized`。
組み込みチップも実装は `dir/status/tools` を含むが docs は未記載。skill 作業とは別に docs 修正 PR を提案。
