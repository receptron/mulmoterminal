# chore: prettier は Jekyll の Liquid テンプレートを触らない (#2187)

## なぜ

`yarn format` がクリーンな main で exit 2 になる。症状は `docs/_layouts/default.html` の
パースエラーだが、原因はそこではない。`docs/` の Jekyll テンプレートは Liquid であって
HTML ではなく、prettier に Liquid パーサはない。対象が2ファイルあって、prettier は
それぞれ違う壊れ方をしている。

## 落ちる方は、落ちているから無事だった

`docs/_layouts/default.html` は just-the-docs 0.12.0 の同名ファイルを1行だけ変えて持って
いるもので、ファイル自身のコメントが「テーマを上げたときは、この1行以外を本家に合わせ直す
こと」と書いている。**upstream と diff が取れることがこのファイルの存在意義**で、prettier が
パースできていたら整形され、それが失われていた。パースエラーが偶然それを防いでいた。

だから「prettier が読める形に書き換える」は取らない。ファイル自身のコメントが禁じている
方向であり、直す対象は prettier の適用範囲の方。

## 落ちなかった方は、実際に壊れていた

`docs/_includes/head_custom.html` は `56fe298e` で prettier を通っていて、`{%- comment -%}`
ブロックが HTML テキストとして reflow され、`{%- endcomment -%}` が `{%-` と `endcomment -%}`
に割れている。Liquid はタグ内の改行を許すので**レンダリングは通る**。当時の検証も「空白を
除けば同一」までで、そこは本当だった。動くが読めない、が見逃された理由。

ignore を同じコミットに入れるので、`56fe298e` が解消した「どのブランチも身に覚えのない diff
から始まる」問題は再発しない。あの commit の目的は ignore の方がうまく果たす。

## どう確認したか

whitespace の議論ではなく、**実際にサイトをビルドして突き合わせた**。`bundle exec jekyll build`
を変更前後で回し、生成物 327 ファイルを `diff -r` で比較して byte-identical であることを確認。
加えて、触ったファイルが出している構造化データそのものも見た: トップページの ld+json が2つ
(`WebSite` と `SoftwareApplication`) 揃ってパースでき、Liquid コメントの中身がページに漏れて
おらず、ガイドページ側には `SoftwareApplication` が出ていないこと。

## 範囲について

ignore するのは `docs/_layouts/` と `docs/_includes/` の2つ。Jekyll のアンダースコア
ディレクトリを一括 (`docs/_*/`) にはしない — `_sass` は SCSS で、prettier が正しく整形できる
側だから。`docs/_config.yml` も同じ理由で対象のまま。
