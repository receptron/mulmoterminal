# chore: configurable Vite dev-server port (CLIENT_PORT)

## 背景
#134 で backend ポートを 3456 → 34567 に変更したが、`yarn dev` で開くのは **Vite の dev ポート（既定 5173）** で、ここは変わっていなかった。フロント（Vue）はポートをハードコードせず `location.host` で相対接続するため、変えるべきは Vite の `server.port` のみ。

## 変更（`vite.config.ts`）
- `BACKEND_PORT = process.env.PORT || "34567"` を導入し、proxy ターゲット4箇所を単一ソース化（backend ポートと一致）。
- `CLIENT_PORT = Number(process.env.CLIENT_PORT) || 6856` を導入し、`server.port` に設定。
  - 6856 = 電話キーパッドの **M-U-L-M**（"MULMO" = 68566 は 65535 を超えるため頭4文字）。
  - backend(34567) とは別ポート必須（dev で同時起動）。env `CLIENT_PORT` で上書き可。
- `yarn dev` で開く URL は **http://localhost:6856**。

## README
- env 表に `CLIENT_PORT`（既定 6856）を追加。
- 「Vite dev server proxies …」の説明と `yarn dev` の注記を更新（開く先＝Vite ポート）。

## 非対象
prod 起動（`yarn server` / `npx`）は従来どおり PORT（34567）で UI＋API 配信。
