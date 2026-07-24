# fix: リモートホスト経路の添付・スキル取りこぼし（#746）

## User Prompt

> mulmoclaude で全ファイルをレビューして…（略）バグを issue 化し、順に対応・CI・レビュー対応・マージまで進める

## 1. spawn 前に staged upload を消すのでリトライ不能（`ingestAttachments.ts` / `handlers.ts`）

`ingest` が Phase1（ワークスペース保存）→ Phase2（Firebase staging 削除）を束ね、
`startChat` はその後に `spawnChat` していた。spawn 失敗（プロバイダトークン未設定等）時には
staging が既に消えており、スマホが同じ storage_id で再送しても添付を再取得できない。

**修正**: `createIngestAttachments` を `{ attachments, cleanupStaging }` を返す形に変更し、
staging 削除を `cleanupStaging`（遅延）に切り出し。`startChat` は
ingest → **spawn 成功後に** `cleanupStaging()` を呼ぶ。spawn 失敗時は staging を残す。

## 2. `extensionForMime` が MIME パラメータを剥がさない（`attachment-path.ts`）

`"text/plain; charset=utf-8"` が完全一致せず `.bin` になる。
**修正**: 最初の `;` 以降を落として trim してから小文字化して引く。

## 3. `onExpire` が params 無しの期限切れ doc で TypeError（`stagedStorageIds.ts`）

`const { attachments } = params` が `undefined` で throw し、never-throw 契約を破る。
**修正**: `params` を `JsonObject | null | undefined` 受けにし、非オブジェクトは `[]`。

## 4. SKILL.md 先頭の UTF-8 BOM でスキルが無言で消える（`skills.ts`）

BOM 付きだと `lines[0] !== "---"` で弾かれる。
**修正**: `parseSkillDescription` を export し、先頭 `﻿` を除去。

## 5. 8桁 hex ファイル名が衝突時に黙って上書き（`attachmentStore.ts`）

32bit 空間で誕生日問題により現実的な件数で衝突し、`rename` が既存を潰す。
**修正**: `randomUUID().slice(0,8)` → 完全 `randomUUID()`。

## テスト

- `ingestAttachments.spec.ts`（test/ と server/ 両方）: ingest は削除せず cleanupStaging で削除。
- `handlers.spec.ts`: spawn 成功後に cleanup 実行 / spawn 失敗時は cleanup せず staging を残す。
- `attachment-path.spec.ts`: charset 付き/空白で正しく引く。
- `parseSkillDescription.spec.ts`（新規）: BOM / CRLF / 正常 / null 系。
- `stagedStorageIds.spec.ts`: params 欠如で throw しない。
- `attachmentStore.spec.ts`: 完全 UUID、2 保存が別名（上書きしない）。
- 4 件の pure 修正はミューテーションで該当テストが赤になることを確認。

全 3556 テスト + typecheck(server/test/app) + lint パス。
