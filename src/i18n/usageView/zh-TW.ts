// The token usage screen (#2919).
export const usageViewZhTW = {
  title: "權杖用量",
  region: "權杖用量",
  close: "關閉權杖用量",
  intro: "tokenRotation 中每個訂閱的剩餘量。新工作階段會在「每週剩餘量 ÷ 距重置的小時數」最大的訂閱上啟動。",
  column: { subscription: "訂閱", fiveHour: "5 小時視窗", sevenDay: "每週視窗" },
  left: "剩餘 {percent}",
  state: {
    measuring: "尚未測量。此頁面或工具列用量開啟時會進行測量。",
    "at-limit": "已達用量上限，在重置之前不會被選用。",
    "no-answer": "上次檢查沒有得到回應。正在以逐漸拉長的間隔重試。",
  },
  limitReset: "{window}：約 {at} 重置（最後一次讀取的值）",
  empty: "尚未設定權杖。",
};
