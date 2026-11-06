# Spike 001：RN/Expo + LangChain.js

对应 GitHub issue #57 的历史实验；不能作为当前应用的开发或验收入口。当前路线见[架构](../../docs/architecture.md)，实验结论与边界见 [ADR-0019](../../docs/adr/0019-react-native-langchain-architecture.md)。

- 节点：Node Agent 基线 → Expo/Hermes → SQLite/checkpoint → EPUB/PDF → 双端闭环
- 证据：每次运行写入 `evidence/`
- 当时结论与评审过程保存在 [历史记录](../../docs/archive/planning/0019-rn-langchain-history.md)
- 输入基线：Swift v0.4.8（commit `2db9fc0`）
