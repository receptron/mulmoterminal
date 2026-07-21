# fix: Claude のプロジェクトディレクトリ名エンコーディングを本家に合わせる (#560)

## 背景

`Windows (daily)` が main で失敗し続けている（`8ba8e7e8` 成功 → `b540d27a` 以降 失敗）。
#556 で追加した `projectSessionsDir` のテストが、既存の実装バグを露出させた。

我々は Claude Code が書いたセッションディレクトリを **読むために** その名前を自前でミラーしている。
規則がズレると存在するディレクトリを見失い、「セッションが無い」と誤認する — 例外は出ず、サイレントに壊れる。

## 本家の規則（`claude` 2.1.216 バンドルから抽出）

```js
const gCt = 200;
function zQe(e){ let t=0; for(let r=0;r<e.length;r++) t=(t<<5)-t+e.charCodeAt(r)|0; return t }
function yeh(e){ return Math.abs(zQe(e)).toString(36) }
function Uw(e){
  let t = e.replace(/[^a-zA-Z0-9]/g, "-");
  if (t.length <= gCt) return t;
  return `${t.slice(0, gCt)}-${yeh(e)}`;
}
function tz(e){ return path.join(X3(), Uw(e)) }   // X3() = <claudeDir>/projects
```

## 現状とのズレ

現状: `path.resolve(cwd).replace(/[/.]/g, "-")`

| # | ズレ | 影響 |
|---|---|---|
| 1 | `/` と `.` しか畳まない。本家は英数字以外すべて | `_`・空白・`~`・`@` を含む path で全 OS 誤り |
| 2 | Windows の `\` と drive の `:` が残る | 区切りを含む文字列を `path.join` に渡し入れ子パスになる（CI 赤の直接原因） |
| 3 | 200 文字上限＋ハッシュ接尾辞が無い | エンコード後 200 文字超の path で誤り |

さらに `server/session/cost.ts:120` に同一実装の複製があり、同じバグを持つ。

## 方針

### 1. 純粋関数を切り出す — `server/session/project-dir.ts`

`encodeProjectDirName(absolutePath): string` を本家と同一規則で実装する。
絶対パスを **引数で受け取る**（`path.resolve` を内部で呼ばない）ので、OS に依存せず
POSIX / Windows 双方の入力をそのままテストできる。

ハッシュは本家と同じ 32bit ローリングハッシュ（`(h<<5)-h+c | 0`）の絶対値を base36 化する。
別のハッシュを使うと別のディレクトリを指すため、再現は忠実でなければならない。

### 2. 重複を一本化する

`session-reads.ts` と `cost.ts` の `projectSessionsDir` を、両方ともこの 1 モジュール経由にする。
`cost.ts` 側の「server 依存を持たないためにコピーした」というコメントの前提は、
純粋モジュールに切り出すことで解消される。

### 3. テストを OS 非依存にする

- `project-dir.spec.ts`（新規）: 純粋関数を網羅的に検証
  - POSIX 絶対パス / Windows 絶対パス（drive + `\`）
  - `_`・空白・`@`・`~`・非 ASCII などの非英数字
  - 200 文字ちょうど / 201 文字（境界）とハッシュ接尾辞の形
  - 空文字、英数字のみ
  - 衝突の記録（本家の規則上、異なる入力が同じ名前に潰れる）
- `session-reads.spec.ts`（修正）: `path.resolve` を経由する部分は OS 非依存の性質だけ残す
  （相対パスの正規化、workspace の区別、`~/.claude/projects` 配下に来ること）。
  POSIX 決め打ちの期待値は純粋関数側のテストに移す。

### 4. teeth 確認

規則を 1 つずつ壊して（英数字以外の畳み込みを `/` と `.` だけに戻す、上限を外す、
ハッシュを別物にする）テストが赤くなることを確認する。

### 5. Windows CI の確認

ローカルに Windows が無いため、feature branch を ref に指定して
`Windows (daily)` をディスパッチし、緑になることを確認してからマージする。

## 追記: 2 つ目の Windows 専用バグ（`writeFileAtomic`）

上記の dispatch（run 29871985889）でエンコーディングの 2 件はパスしたが、
別のテストが落ちた:

```
FAIL test/server/files/atomic-write.spec.ts > writeFileAtomic > survives concurrent writes to the same path
EPERM: operation not permitted, rename '...\state.json.<uuid>.tmp' -> '...\state.json'
```

`server/files/atomic-write.ts` は「atomic on POSIX + Windows」「一意な temp 名により
二者が同時に使える」と謳っているが、Windows では**同一 dest への rename が
瞬間的なロックで EPERM を返す**（並行 writer 自身の rename、インデクサ、ウイルススキャナ）。
POSIX の rename は競合しても勝つのでこの問題は出ない。つまり実装がコメントの約束を
Windows で守れていない。

このテストは #556 (`c77232c`) で新規追加されたもので、green だった `8ba8e7e8` には
存在しない。過去の赤 run では偶然パスしていた = Windows で flaky。

### 修正

`rename` を `EPERM` / `EACCES` / `EBUSY` の間だけバックオフ付きでリトライする。
リトライを使い果たしたら最後の試行のエラーをそのまま投げる（書けていないのに
成功を報告しない）。

テスト可能性のため:
- `isRenameContention(err)` を純粋述語として切り出す
- `renameWithRetry` は `renameFile` と `wait` を注入可能にする
  → Windows ホストが無くてもリトライ挙動を全プラットフォームで決定的に検証できる
