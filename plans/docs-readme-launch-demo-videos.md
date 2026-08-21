# ローンチデモ動画を README とユーザーガイドに載せる

Issue: #1827

## 背景

英語圏ローンチ（Hacker News への Show HN 投稿）の投稿リンクはこのリポジトリで、HN から来た読者が最初に見るのは README になる。現状 README の視覚要素は `hero.gif` だけで、ローンチ動画（並列で動いている複数エージェントの状態が一目で分かる、を 90 秒で見せるもの）が入っていない。

動画は 2 本とも作成・アップロード済み。

| 版 | 長さ | サイズ | 解像度 |
|---|---|---|---|
| 英語 | 91.6 s | 3.3 MB | 1280x720 h264 High + aac LC |
| 日本語（ナレーションのみ日本語・画面は英語版と同一） | 93.5 s | 3.4 MB | 同上 |

## 公開アクセスの確認（実施済み）

issue #1827 が投稿されたことで user-attachments の 2 URL は公開になった。未ログイン（Cookie なし）の `curl` で両方 302 → 署名付き S3 URL を返し、実体を取得して `ffprobe` が上表のとおりに読めることまで確認した。README にはこの URL をそのまま貼る。

## 置き場所の方針

**README = user-attachments の URL を 1 行。** GitHub は README 内の user-attachments URL をインラインの `<video>` として描画する。リポジトリに mp4 を持たなくてよく、`package.json` の `files` は `docs/` を含まないので npm の tarball にも影響しない。

**ガイド = リポジトリにコミットして相対参照。** user-attachments の URL は署名付き S3 URL への 302 で（署名の寿命は 5 分。リダイレクトはリクエストのたびに発行し直されるので、Range リクエストも含めて今日は素の `<video src>` から再生できることを確認した）、GitHub が文書化していない内部エンドポイントに依存する。ガイドは長く残るページなので、`docs/guide/videos/` に mp4 をコミットして Pages 自身に配らせ、各言語の index から `../videos/…` で参照する。

## 変更

1. **`README.md`** — 既存の `hero.gif` の直前に `## Demo` の見出しを置き、直下に英語版の URL を 1 行貼る。見出しがあることで Show HN のコメント等から `#demo` アンカーで直接誘導できる。`hero.gif` は残す: 動画のポスターフレーム（0 秒目）は単一セルの静止画で、gif が持っている「グリッドが色を変えながら動く」第一印象を代替しない。静止したポスター + 再生ボタンの下で gif がループする形になる。
2. **`docs/guide/videos/`** を新設し、英語版・日本語版の mp4 をコミットする。何をどう撮ったかの inventory として `README.md` を同梱（`images/README.md` と同じ役割）。コミットするのは添付そのままではなく `ffmpeg -c copy -movflags +faststart` でリマックスしたもの — 元のファイルは `moov` が末尾にあり、ブラウザが最初のフレームを描くのに末尾への Range リクエストを 1 往復余計に要する。無劣化で、ストリーム・フレーム・バイト数は同じ（デコード後の framehash の一致を確認済み）。
3. **`docs/guide/en/index.md` / `docs/guide/ja/index.md`** — 最新リリースのバナーの直後、「はじめての方へ」の直前に `<video>` を置く。バナーより上には置かない: CLAUDE.md のリリース手順が「index はこのバナーで始まる」と定めているため。
4. **`.gitattributes`** — `*.mp4 binary` を追加する。既存の binary 指定は png / jpg / gif / ico / woff だけで、mp4 が入っていない。

## 確認したこと

- 2 URL が未ログインで取得できること（上記）
- 動画に maintainer のディレクトリ・アカウント名が写っていないこと。13 フレームのコンタクトシートで通し確認した。デモ用の `HOME` とデモ用プロジェクト（`acme-*`）で撮られている
- ガイドから追加した相対参照（`../videos/launch-demo-{en,ja}.mp4`、`../images/README.md`）がすべて実在のファイルに解決すること
- コーデックがブラウザの共通線であること（h264 High / yuv420p / level 3.1 + AAC-LC 44.1 kHz stereo）

## レビュー対応（iteration 1）

CodeRabbit と Codex GHA が同じ 1 点を指摘した: ナレーション付き動画に字幕も文字起こしも無く、音声を聞けない読者に情報が届かない（README / ガイド en / ガイド ja の 3 箇所）。

対応: 3 箇所とも、プレイヤーの直下に `<details>` で折りたたんだナレーション全文を置いた。本文は動画を生成した MulmoScript デッキ（`mulmo-presentations/mulmoterminal/launch/mulmoterminal-launch-v8{,_ja}.json`）からの逐語転記。デッキはレンダリング後にも編集されうるので、mulmocast がレンダリング時に `_studio.json` へ埋め込んだ `script` と突き合わせ、10 ビートすべてが一致することを確認した（PR の mp4 がそのレンダリングと同一であることは sha256 で確認済み）。`<details>` は GitHub のサニタイザを通るので、`<video>` が丸ごと落とされる github.com 上のガイド `.md` でも本文が読める。

同期字幕（WebVTT `<track>`）: いったん見送ったが、同じラウンド内で追加できた（下記）。当初見送った理由 —ビートごとの時刻は mulmocast が `_studio.json` の `startAt` に書くが、このレンダリングの studio ファイルには無い（movie ステップを通した studio にしか書かれない）。手元にある 8/19 の studio の時刻は 1 つ前の文面（ビート 2・7 が別の文）のもので、ビート 2 以降がずれる。`record-youtube-publish` の `youtube-chapters.js` の推定も「固定尺の html_tailwind ビートがある」として拒否した。再レンダリングすれば時刻が出るので、follow-up で扱う。

### 同期字幕の追加（同ラウンド）

presentations の worktree で `yarn movie` を再実行（TTS・コマ撮りはキャッシュ、組み立てのみ）して movie 産の studio を復活させ、`_studio.json`・`audio/`・`images/` を main へ cp してもらった。その studio は全ビートに `startAt` を持ち、埋め込み script は現行の文面。公開版 mp4 との整合は次で確認した:

- `youtube-chapters.js` が studio から時刻を読み、mp4 に対する STALE / DRIFT を出さない
- 最終ビートの `startAt + duration + introPadding + outroPadding` が mp4 の尺と一致する（en 91.638 s / ja 93.536 s、小数 3 桁まで）
- 発話区間の検出と cue の切れ目の照合、境界前後のフレームの目視

ブラウザ側の検証もローカルで行った（Jekyll は手元で動かないので、ガイドと同じ `<video>` マークアップのテストページを静的サーバで配り、Playwright の Chromium で確認）: 両言語とも `textTracks[0].cues.length === 10`、kind / srclang / label が期待どおり、7 s・23 s・85 s（ja は 86.5 s）で `activeCues` が期待の文、タイピング区間（60 s / 62 s）では空、そして字幕がプレイヤー上に描画されていることをスクリーンショットで確認。残るのは本番 Pages が `.vtt` を `text/vtt` で配るかだけで、これはデプロイ後に `curl -sI` と CC ボタンで確かめる。

cue は 1 ビート = 1 cue。開始 = `startAt + introPadding`、終了 = 開始 + `audioDuration`（声が止まる時刻。ビート末の無音や固定尺の残りは含めない）。`<track>` に `default` は付けていない — 画面が端末 UI なので、字幕は読者が CC で出す。README の GitHub 製プレイヤーには track を付けられないので、そちらは文字起こしのみ。
