export const transcriptPaneJa = {
  transcriptPane: {
    title: "会話",
    loadingOlder: "古い会話を読み込み中…",
    scrollOlder: "上へスクロールすると古い発言を読めます。",
    cutHere: "…ここで省略",
    speakers: { agent: "エージェント", you: "あなた", tools: "ツール", unreadable: "読めないブロック" },
    empty: {
      failed: "このセッションの会話を読めませんでした。",
      notStarted: "このセルはまだセッションを開始していません。",
      loading: "読み込み中…",
      cleared: "この会話は /clear で終了しました。次のプロンプトで新しい会話が始まります。",
      tooLarge: "このトランスクリプトは大きすぎて発言を見つけられません。",
      notSupported: "このエージェントの会話は、このペインではまだ読めない場所にあります。",
      none: "このセッションのトランスクリプトには、まだ何もありません。",
    },
    head: {
      failed: "この発言より前の発言を読めませんでした。",
      tooLarge: "これより前の発言は大きすぎて読めません。",
      cleared: "これより前の会話は /clear で終了しました。",
      start: "この会話の始まりです。",
      none: "これより古い発言は読めませんでした。",
    },
  },
} as const;
