# feat(#1062): `--append-system-prompt` の注入をオン/オフできるようにする

## 背景

`server/agents/claude-args.ts` は毎回の spawn で `--append-system-prompt` を無条件に渡している。
中身は2セクション。

| セクション | 出所 | 条件 |
| --- | --- | --- |
| `## Closing summary`（2,067 バイト / 32行） | `server/agents/session-summary-prompt.ts`（#942, #1027） | **無条件** |
| `## Which clone this work is in` | `server/agents/pr-clone-prompt.ts`（#973） | cwd が git リポジトリ **かつ** グローバル設定 `prWorkdirFooter !== false` |

後者は既に `prWorkdirFooter` でオフにできる。オフにできないのは前者だけ。

**機械的な依存はない。** サマリの `---` 区切りや見出しをパースしているコードは存在しない
（grep 済み）。ロスターに出る `lastResponse` は「最後のアシスタント発言を truncate しただけ」
（`server/session/summary-scan.ts:85`）で、構造を読んでいない。オフにしても壊れる機能はなく、
影響はロスターとプッシュ通知に出る末尾テキストの読みやすさだけ。

## 決めたこと

- 設定キーは **`appendSystemPrompt`**、値は **union（`boolean` — 将来 `| string`）**。
- 3値の意味づけ: `true`/キー省略 = preset、`false` = off、文字列 = ユーザ任意。
  **今回は `boolean` のみ実装する。** 文字列（custom）は将来の拡張として、キー名も解決の
  流れも変えずに足せる形だけ確保する。
- 既定は **preset**。キーが無い既存の設定ファイルは今までどおり注入される。
- 適用範囲は **グローバル + ディレクトリ単位**。`.mulmoterminal.json` の値がグローバルに勝つ。
- `prWorkdirFooter`（PR クローン行）とは**独立**のまま。片方を切ってももう片方は生きる。

### 値の解決順

1. `<cwd>/.mulmoterminal.json` の `appendSystemPrompt`（`boolean | null`、null = 未設定）
2. `~/.mulmoterminal/config.json` の `appendSystemPrompt`（`boolean`、既定 `true`）
3. 結果が `false` なら `SESSION_SUMMARY_PROMPT` を付けない

`prWorkdirFooter` と同じく **spawn ごとに読む** ので、切り替えにサーバ再起動は要らない。

### 組み立ての置き場所

「何を append するか」を決める関数を1つに集める。将来 custom を足すとき触るのがそこだけになる。

```
server/agents/appended-prompt.ts   (新規)
  appendedSystemPrompt({ dirSetting: boolean | null, globalSetting: boolean, workdirFooter: string | null }): string | null
    summary = dirSetting ?? globalSetting
    - summary かつ footer あり → SUMMARY + "\n\n" + prClonePrompt(footer)
    - summary かつ footer なし → SUMMARY
    - !summary かつ footer あり → prClonePrompt(footer)   ← PR 行だけは残る
    - !summary かつ footer なし → null（フラグ自体を渡さない）
```

**ディレクトリ優先の解決もこの関数の中**に置く。バグが潜むのはそこで、spawn の本体は PTY 無しに
テストから触れないため。spawn 側は 1 行の呼び出しだけになる。

`buildClaudeArgs` は `workdirFooter` を受け取るのをやめ、解決済みの
`appendedPrompt: string | null` を受け取って **置くだけ**にする（純粋な argv ビルダに戻す）。
`null` のときは `--append-system-prompt` を push しない。

## 変更するファイル

### サーバ

- `server/agents/appended-prompt.ts` **(新規)** — 上記の合成関数。
- `server/agents/claude-args.ts` — `ClaudeArgsInput.workdirFooter` を `appendedPrompt: string | null`
  に置き換え、`null` ならフラグを渡さない。`SESSION_SUMMARY_PROMPT` / `prClonePrompt` の import は
  新モジュールへ移動。
- `server/session/spawn-claude.ts` — `appendedSystemPrompt({ setting: sessionAppendSystemPrompt(cwd), workdirFooter: sessionWorkdirFooter(cwd) })`
  を組み立てて渡す。`sessionAppendSystemPrompt(cwd)` は dir 設定 → グローバルの順で解決。
- `server/config/app-config.ts` — `appendSystemPrompt: boolean` をフィールドに追加。
  `sanitizeAppendSystemPrompt(input) => input !== false`（`prWorkdirFooter` と同じ「明示的な
  `false` だけがオフ」）、`DEFAULTS` / `sanitizeAppConfig` / `mergeConfigUpdate` / 直列化に追加。
- `server/config/config-routes.ts` — `getAppendSystemPrompt(): boolean`。
- `server/config/config-schema.ts` — `dirAppendSystemPromptField = z.boolean().nullable().catch(null)`
  と、`writableDirConfigSchema` への `appendSystemPrompt: z.boolean().optional()`
  （config スキルに配られる JSON Schema に載せるため）。
- `server/config/dir-config.ts` — `DirConfig.appendSystemPrompt: boolean | null`、`EMPTY` は `null`、
  ローダに parse を追加。
- `common/dirConfigSource.ts` — `DIR_CONFIG_KEYS` に `"appendSystemPrompt"` を追加
  （`dir-config.spec.ts` がローダとこのリストを突き合わせている）。設定モーダルのプレビューでは
  `false` は `isEmptyValue` が空とみなさないので **applied** として出る。

### テスト

- `test/server/agents/appended-prompt.spec.ts` **(新規)** — 4分岐（on/off × footer 有無）、
  off + footer なしで `null`、2セクションの連結順、ディレクトリ優先の4通り。
- `test/server/agents/claude-args.spec.ts` — `workdirFooter` を渡していた箇所を `appendedPrompt` に
  移行。`appendedPrompt: null` で `--append-system-prompt` が argv に現れないことを追加。
  `--add-dir` が最後、という既存の不変条件は維持。
- `test/server/config/app-config.spec.ts` — 既定 `true`、`false` の永続化、キーが無い既存設定が
  `true` のままであること、`mergeConfigUpdate` の据え置き。
- dir-config の spec — `appendSystemPrompt: false` が読めること、不正値（文字列など）が `null` に
  落ちること、`DIR_CONFIG_KEYS` との突き合わせ。

- `test/server/config/config-schema.spec.ts` — 生成される JSON Schema に `appendSystemPrompt` が
  boolean で載ること（載っていないと config スキルがこのキーを書かない）。

### ドキュメント

- `docs/guide/{en,ja}/config.md` — `prWorkdirFooter` の節の隣に `appendSystemPrompt` の節を追加
  （何が注入されているか / オフにすると何が変わるか / dir とグローバルの優先順）＋ 末尾のキー表と
  ディレクトリ設定の節に行を追加。
- `README.md` — Closing summary の節に「オフにできる」ことと解決順、グローバル／ディレクトリ双方の
  キー表に行を追加。
- `server/skills/mulmoterminal-config/SKILL.md` — Settings モーダルに UI が無いキーを扱うのが
  このスキルの役目なので、グローバルの節と dir キーの節を追加。

`docs/ChangeLog.md` とセットアップガイドはリリース時（`/publish`）に書くのでここでは触らない。

## 将来 custom（ユーザ任意）を足すときに触る場所

キー名も設定の場所も変えずに済むよう、以下だけで足りる形にしておく。

1. サニタイザを `boolean | string` に広げる（グローバル側と dir 側の両方）。
2. `appendedSystemPrompt` の `setting` の型を `boolean | string` にし、文字列なら preset の
   代わりに使う。
3. 文字列のサニタイズ **3点**（今回は実装しないが、足す側が必ず要る）:
   - **ASCII ダブルクォート禁止**（#813）。Windows spawn の argv に乗るので `"` は `”` へ置換。
     `test/server/session/session-settings.spec.ts` が spawn 全体で argv の不変条件を張っている。
   - **4096 バイト上限**（`session-summary-prompt.spec.ts` の `MAX_PROMPT_BYTES`）。tmux の
     "command too long" から一桁の余裕を保つための値。超過は preset にフォールバック＋警告ログ。
   - **NUL 除去と trim**。NUL は argv をそこで切り、末尾改行は diff に見えない。

## 非対象

- Settings モーダルへの UI 追加（`prWorkdirFooter` も設定ファイルのみ。同じ扱いにする）。
- `SESSION_SUMMARY_PROMPT` の文面変更。
- `prWorkdirFooter` の挙動変更。
