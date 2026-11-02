# RN / Expo + LangChain.js 技术 Spike

状态：2026-11-02 开始，对应 GitHub issue #57。  
基线：Swift v0.4.8 `2db9fc0`。

## 目录

- `packages/core`：共享领域、Agent、RAG、DB schema；禁止 import react-native。
- `packages/reader-web`：WebView 内 foliate-js / pdf.js。
- `apps/mobile`：Expo iOS/Android 壳。
- `apps/eval`：Node 真实书问题集。
- `spikes/001-rn-langchain`：阶段证据与报告。

## 依赖规则

1. `packages/core` 不得 import `react-native` 或 Node 专属运行时；端口注入。
2. `apps/mobile` → `packages/core`，反向禁止。
3. `reader-web` 只通过消息协议与 mobile 通信。
4. 界面只消费自定义 `AgentEvent`，LangChain 类型不出 `core/agent`。

## 验证顺序

V1 Agent 运行时（Node → Expo/Hermes，双端真机）
V2 离线检索（端侧 embedding/FTS/向量）
V3 阅读与迁移（EPUB/PDF/锚点/旧数据）
V4 checkpoint 恢复
V5 业务闭环与性能基线

未取得双端真机证据前，不宣称架构验收通过。
