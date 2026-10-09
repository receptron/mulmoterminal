// The token usage screen (#2919).
export const usageViewZhCN = {
  title: "令牌用量",
  region: "令牌用量",
  close: "关闭令牌用量",
  intro: "tokenRotation 中每个订阅的剩余量。新会话会在“每周剩余量 ÷ 距重置的小时数”最大的订阅上启动。",
  column: { subscription: "订阅", fiveHour: "5 小时窗口", sevenDay: "每周窗口" },
  left: "剩余 {percent}",
  state: {
    measuring: "尚未测量。此页面或工具栏用量打开时会进行测量。",
    "at-limit": "已达到用量上限，在重置之前不会被选用。",
    "no-answer": "上次检查没有得到回应。正在以逐渐拉长的间隔重试。",
  },
  limitReset: "{window}：约 {at} 重置（最后一次读取的值）",
  empty: "尚未配置令牌。",
};
