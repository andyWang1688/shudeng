---
status: proposed
date: 2026-11-02
---

# 以 React Native/Expo + TypeScript + LangChain 重建多端架构

## 背景

书灯当前的 iOS 版本是 Swift/UIKit 原生应用，约 16,800 行生产代码和 13,700 行测试。阅读器、PDF、标注、书内索引和原生 Agent 都绑定在 Swift 上，Agent 的工具循环、流式思考、上下文压缩和引用核对是项目自研实现。

继续在单端 Swift 上叠加 Agent 能力，会让每新增一层能力都增加未来多端的迁移成本。GitHub issue #57 决定启动架构重构，目标是：

1. 一套业务代码覆盖 iOS/Android，减少多端重复实现。
2. Agent 骨架使用成熟的 LangChain/LangGraph 生态，而不是继续扩写自研循环。

现有 Swift 版保持不动，作为行为基线、回退包和旧数据迁移参照。

## 决定（草案，待双端验收）

- 采用 **React Native/Expo + TypeScript** 作为共享应用层。
- Agent 使用 **LangChain.js + LangGraph.js**，在设备 Hermes 内运行；不引入 AI 服务器，模型请求仍由用户配置的供应商直连。
- `packages/core` 只放纯 TypeScript 领域、Agent、RAG、DB schema；禁止 import React Native/Node 专属运行时。
- UI 与平台能力通过注入的端口访问；`packages/core` → 无平台反向依赖。
- 阅读器允许平台差异：EPUB 用 WebView + foliate-js，PDF 用 pdf.js 或原生模块；阅读器不是“一套 UI”必须完全一致的强制项。
- 界面只消费自定义 `AgentEvent`；LangChain 类型不出 Agent 模块。
- 旧数据使用版本化 `Anchor` 迁移，不直接用 CFI/新坐标覆盖旧 Readium Locator/PDF 坐标。

## 当前证据

已完成（2026-11-02 更新）：

- **iOS 原生**：Agent 事件链、SQLite/LangGraph checkpoint、WebView EPUB/PDF 渲染/选字/高亮、native ORT embedding（cosine=1）。
- **Android 原生**：同一 Agent 事件链、SQLite/checkpoint、EPUB WebView、native ORT embedding（cosine=1）均在 Debug emulator 通过；Gradle 使用 Aliyun 镜像，ORT Android 需显式 autolink + Gradle 9 patch。
- **V5 Node 业务闭环**：脱敏旧库迁移 → SQLite → 真实 ONNX 索引 → LangChain Agent 3 题引用核对，11/11 PASS；1000 chunk 索引 median **9.73s**，进程 max RSS **707MB**，查询 FTS/vector/hybrid p50 0–5ms。
- **V5 Android 原生闭环**：dev route 在 Hermes 执行 SQLite→真实 ONNX 索引→SqliteBookSource→LangChain Agent→引用 E1 核对→answer，PASS；iOS 同 bundle 已包含，自动化深链确认框未点按。
- **Release 构建 smoke**：iOS Release simulator app **179MB**（可执行 115MB）；Android Release APK **240MB**（debug signing，未发布签名）；Android Release Agent 闭环可运行，冷启动单次约 **1.15s**。


- `packages/core` Node Agent：LangChain `createAgent` + LangGraph、书内工具、引用核对、AgentEvent、DeepSeek reasoning 工具轮回传；core 测试 22+，eval 3/3。
- Expo/Hermes 打包：iOS/Android/Web 导出成功；Web 运行时同一 core Agent 跑通 reasoning → search_book → citation → completed。
- reader-web：foliate-js EPUB、pdf.js PDF；选字、CFI/归一化 rect、标注、深色；Expo WebView 接线与 CDP 验证。
- SQLite/Drizzle：共享 schema、迁移、Expo/Node 驱动、异步 LangGraph checkpoint saver；Node 与 Expo bundle 验证。
- 真实 ONNX embedding（Node）：MiniLM int8、384 维、中英/跨语言召回 5/5；RAG FTS5 + vector 混合。
- Expo ONNX 适配器：onnxruntime-react-native 1.24.3 + 纯 JS tokenizer，三平台 bundle 通过。
- **iOS 原生 ONNX 已验证**：用本地 pnpm patch 修复 RN 0.88 New Architecture 下的 legacy bridge 兼容（`patches/onnxruntime-react-native@1.24.3.patch`），模拟器 tokenIds 全等、cosine=1（对 Node 1.31.1 基线，bit 级一致）。代价是每次升级 RN/ORT 需要重验 patch；Android 仍需对应补丁（#33081）或替代执行器。
- **Embedding 执行器决策（近期）**：采用 `onnxruntime-react-native` + 本地 patch（A）；`onnxruntime-web` 纯 WASM 在 WKWebView 已验证（tokenIds 全等、minCos 0.99966），保留为 fallback；Swift SPM/TFLite/ExecuTorch/CoreML 不作为当前主路线。`EmbeddingProvider` 端口保持可替换。

未验证：

- iOS/Android 原生运行（CocoaPods/React-Core-prebuilt 网络阻塞；Android 无 SDK）。
- Android Hermes 上 ORT/tokenizer 内存/首 token/Release 表现；Android Debug 的 tokenIds/cosine 已与 Node 参考一致。
- 旧数据迁移、PDF 大文件/连续滚动、真机手势/坐标换算、checkpoint 清理生命周期。
- 真实 DeepSeek/Anthropic 网络请求、Anthropic thinking blocks 回传。
- **移动端索引/推理耗时、内存峰值、真实书问题集**：当前只有 Node/PC 基线；Release 包体已采样，明显高于 Swift 版，需进一步裁剪/按需下载评估。
- **移动端完整业务闭环**：Android 已用一个 dev route 串起 SQLite→真实 ONNX 索引→Agent→引用核对；iOS 未自动截图，引用点击回跳阅读器仍未串。
- **真实 provider 网络**、Anthropic thinking 回传、真实手势/大 PDF。

## 进入正式迁移的门槛

- V1：iOS + Android 真机跑通同一 Agent（流式思考、工具循环、取消、引用）。
- V2：端侧 embedding/检索可用（iOS 已验证 native ORT；Android 需补丁/替代执行器），中文/跨语言召回有固定问题集证据。
- V3：真实 EPUB/PDF、旧数据副本迁移、标注坐标与回跳通过真机验证。
- V4：取消/断网/杀进程后的 checkpoint 恢复明确。
- V5：完整业务闭环 + 与 Swift v0.4.8 的包体/启动/内存/交互对照。当前只有 Node 闭环、双端分段通过和 Release 体积采样；**179/240MB 只是 simulator/debug-signing 采样，iOS 未 archive、Android APK 未按 ABI 拆分/minify；需用真实发布配置再比较，迁移前必须给出解释/优化**。
- 汇总通过/失败/未验证项，锁定阅读器、推理、checkpoint 驱动和依赖版本后，本 ADR 才可从 proposed 改为 accepted。

## 后果

- 迁移期间需要双线维护；Swift 版继续作为回退。
- 阅读手感、PDF 大文件内存、包体/启动可能回退，必须在真机验收中量化。
- “一套代码”不等于 100% 共享；PDF/标注/分享/通知等平台模块允许原生。
- LangChain 节省 Agent 编排样板，但 provider reasoning/tool 细节仍需适配层。
- 不引入服务端；跨设备同步、账号、远程 MCP 代理仍为后续独立决策。

## 备选

- Flutter + Dart + LangChain Dart：更接近原生自绘，但 LangChain Dart 生态较小、WebView 阅读面仍需桥接。
- 原生客户端 + TypeScript LangGraph 服务端：Agent 统一，但需要服务器，且不满足共享 UI 代码。
- 维持 Swift 单端：阅读手感最稳，但多端与 Agent 能力重复实现，迁移成本继续上升。

## 关联

- GitHub issue #57
- `docs/design/rn-langchain-spike.md`
- 现有 Swift Agent 契约：`docs/design/native-agent-runtime.md`
- 对照审计：`docs/design/agent-parity-audit.md`
