# 道具（#3332）

親: #3327。設計は `docs/library-design.md` の「Tools and storage」。

大きいので PR を分ける。どれも単独で戻せる。

1. **指示ファイル**（この PR）: ディレクトリを一つ選ぶと、そこで Claude Code が読む `CLAUDE.md` などを、読む順に並べて中身を読める
2. **設定の重なり**: 権限・フック・環境変数・MCP を、各 `settings` を重ねた結果として、どのファイルで決まったかを添えて
3. **スキルとフックの使われ方**: 会話記録の `attributionSkill` と `hookErrors` から
4. **参照の検査**: `CLAUDE.md` や `SKILL.md` が挙げるファイルが実在するか（追加の要望）
5. **スキルの編集**（追加の要望）。スキルを改善するスキルをどうするかは別に決める

## 一つ目の PR（指示ファイル）

- 読む順と場所は Claude Code の説明（code.claude.com/docs/en/memory）に合わせる。純関数 `instruction-files.ts`:
  - 組織の `CLAUDE.md`（macOS / Linux / Windows でそれぞれの場所）、自分の `CLAUDE.md`（設定フォルダ。`CLAUDE_CONFIG_DIR` に従う）、自分の `rules/`
  - ファイルシステムのルートから作業ディレクトリまで、各ディレクトリの `CLAUDE.md` と `CLAUDE.local.md`（同じディレクトリでは `CLAUDE.local.md` が後）。作業ディレクトリでは `.claude/CLAUDE.md` も
  - プロジェクトの `.claude/rules/` の `.md`（下のフォルダも）。frontmatter に `paths` があるものは「当てはまるファイルを扱うときだけ」
  - `@path` の取り込み: そのファイルのフォルダから解く、`~/` はホーム、`\ ` で空白、引用符で囲んだものとコードの中は取り込まない、四段まで、同じファイルは一度
  - `CLAUDE.md` / `.claude/CLAUDE.md` / `CLAUDE.local.md` が作業ディレクトリにも上にも無いときは、代わりに各ディレクトリの `AGENTS.md` と `.claude/AGENTS.md`（既定の設定のとき。自分の `CLAUDE.md` と組織のものは数えない）
  - 4 MiB を超えるファイルは Claude Code が読まないので「読まれない」と出す
- 下のディレクトリの `CLAUDE.md` は、そこを触ったときに読まれるもので起動時ではないので、出さない。`claudeMdExcludes` と「どの指示ファイルを読むか」の設定は、この PR では見ない
- 経路はパスを受け取らない側に寄せる: ディレクトリは会話が動いたことのあるものだけ（`directories`）、ファイルはそのディレクトリの一覧に出たものだけ。中身はリンクの先も読む（Claude Code がたどるので）
- 実機の確かめ: このリポジトリで一覧を出し、このセッションの起動時に Claude Code が読み込んだファイル（`~/.claude/CLAUDE.md`、`~/ss/llm/CLAUDE.md`、このリポジトリの `CLAUDE.md`）と同じ三つが同じ順に出ることを見た
