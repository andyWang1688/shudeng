/** Verbatim AIPrivacyController(.sending) content from the native baseline. */
export const AI_SENDING_DETAILS = [
  {
    heading: "发送哪些内容",
    body: "阅读问答会发送你的问题、相关书内原文和理解追问所需的对话历史；原文可能来自其他章节。本机检索不表示 AI 回答全程离线，也不表示每次发送整本书。",
  },
  {
    heading: "发送给谁",
    body: "请求直接发往你配置的 AI 服务地址。使用代理地址时，代理也可能接收这些内容；请只选择你信任的服务。地址、服务商或接口格式改变后需要重新确认发送说明。",
  },
  {
    heading: "费用与检查",
    body: "书灯不提供或代付 AI 服务，服务商可能按其规则收费。检查连接仅发送固定短文字，不发送书内原文；检查成功不会保存配置或 API Key。",
  },
  {
    heading: "你的选择",
    body: "保存或切换服务前可以取消。未配置 AI 或未确认发送说明，不影响本机阅读、笔记、书签和离线回看。更多保留与使用边界见“我的 → 关于书灯 → 隐私政策”。",
  },
] as const;
