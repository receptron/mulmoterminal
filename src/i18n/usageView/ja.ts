// The token usage screen (#2919).
export const usageViewJa = {
  title: "トークンの使用量",
  region: "トークンの使用量",
  close: "トークンの使用量を閉じる",
  intro: "tokenRotation に登録した各契約の残りです。新しいセッションは、週の枠の残りをリセットまでの時間で割った値が最も大きい契約で始まります。",
  column: { subscription: "契約", fiveHour: "5 時間枠", sevenDay: "週の枠" },
  left: "残り {percent}",
  state: {
    measuring: "まだ測っていません。この画面かツールバーの使用量を開いている間に測ります。",
    "at-limit": "上限に達しています。リセットされるまで選ばれません。",
    "no-answer": "前回の確認に応答がありませんでした。間隔を空けながら再試行します。",
  },
  limitReset: "{window}: {at} ごろにリセット（最後に確認した値）",
  empty: "トークンが登録されていません。",
};
