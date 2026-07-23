# fix #674 — presetsForProvider の重複排除だけ大文字小文字を区別していた

対象 issue: https://github.com/receptron/mulmoterminal/issues/674

## 問題

モデル id の照合基準が 2 箇所で食い違っていた。

- `common/modelPresets.ts` `presetsForProvider` の重複排除 — **raw 一致**(`known.has(id)`)
- `src/components/modelOption.ts` `presetFor` — **case-insensitive**(`preset.id.toLowerCase() === model.toLowerCase()`)

ユーザが config の `providers[].models` にプリセットと同じモデルを大小混在で書く(例 `"MoonshotAI/Kimi-K2.7-Code"`)と、dedup をすり抜けて「unmeasured (not tested)」エントリが追加され、ランチャーのモデルピッカーに**同一モデルが 2 行**並ぶ。dedup のコメント(“keeps the preset's measured numbers rather than appearing twice”)が防ぐと明言している事態そのもの。

## 修正

`known` を小文字化した集合にし、`id.toLowerCase()` で判定する。`presetFor` と同じ照合基準に揃える。

## テスト

`test/server/config/launch-options.spec.ts` に大小混在ケースを 1 本追加。修正を戻すと赤・入れると緑を確認済み(変異テスト)。
