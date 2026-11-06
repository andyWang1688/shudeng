# RN 代码结构与可靠性整理

范围：`codex/reading-agent-rebuild-20261104` 的当前 RN 应用和共享 Core。此次按实际调用关系整理组件、数据边界与依赖；原生基线、迁移资料和用户数据不作为死代码处理。

## 目录与模块边界

| 位置 | 职责与复用方式 |
| --- | --- |
| `apps/mobile/app/` | Expo 路由及各自导航栈，只组装页面。书架、笔记、对话的系统导航配置集中在 `src/ui/navigation/`，保留各自标题和路由。 |
| `apps/mobile/components/assistant-ui/` | 官方 registry 组件及必要的 RN 适配，来源和本地差异由该目录 README/manifest 记录。书灯的选文、引用、上下文展示放在 `src/ui/chat/`。 |
| `apps/mobile/src/platform/` | SQLite、文件、密钥、模型执行器等平台接线；`library/` 管理本地书籍与会话，`db/` 只连接正式数据库。开发检查从显式开发入口调用。 |
| `packages/core/src/` | 无移动端反向依赖的 Agent、检索、领域类型和数据库策略；Node SQLite/ONNX 执行器保留独立子路径。 |

未按文件行数机械拆分阅读器，也未把业务相似但生命周期不同的设置表单强行合成通用框架。共享内容以稳定职责为界：系统搜索、导航外观、向量候选排名、原文窗口/游标及数据库事务。

## 具体整理

1. 三页系统搜索共用 `useNativeListSearch`，统一查询、清除、取消和原滚动位置恢复。卸载、重新聚焦或 effect 重放会使旧 RAF 失效。删除不再使用的手写页头/搜索组件及其主题辅助函数。
2. 聊天只保留实际使用的 assistant-ui 路径，删除旧消息视图、旧输入/列表和文字准备链，退役 `shudeng-text-metrics` 原生模块及旧 Markdown 依赖。测试改为经过当前真实线程、材料与引用按钮，保留草稿和主题/导航覆盖。仍被静态导入的官方附件组件及依赖保留。
3. SQLite 初始化失败关闭本次连接，关闭与重试的生命周期串行。普通新会话绕过旧 JSON；旧会话的兼容读取和归属推断继续保留。移除/删除书籍只查询必要会话 ID，避免加载全库消息。移除生产公共入口中的 spike 数据库与开发检查出口，不删除任何磁盘数据库。
4. Expo 事务用独立 transaction adapter，事务内语句不重新等待自己的根队列，事务外读写等待事务结束。独立复核另发现 Drizzle 原有事务会绕过此锁，现将对话删除与评测写入改走 `withTransaction`，使用注入驱动和事务内局部 Drizzle；公开类型隐藏不安全的原 `.transaction`。设置编辑器用同步锁拒绝同帧重复操作和旧菜单回调，返回时立即使迟到结果失效；MCP 配置和工具持久化期间禁止取消，提交后的授权版本与界面同步。
5. 新旧索引共用有界去重排名及原文分页策略。旧向量按 64 行分页读取，只接受确认兼容的模型身份；同维度本身不代表可比较。选文匹配的字符偏移贯穿原文窗口，前置长片段不会耗尽预算而挤掉目标；新旧索引的末尾选文、emoji 续读及显式 locator 回读均经独立复验。搜索、只读分页与写入接口各自表达实际能力。清理无写入的 Agent Map/空分支与未用导入、参数和辅助函数。

旧整包 EPUB 解析器目前只服务独立解析测试及兼容导出，保留为 file-backed 解析器的独立参照；两者规则已有差异，直接删掉会失去交叉验证能力。

## 持续检查

```sh
pnpm -r typecheck
pnpm test
```

移动端也可单独运行 `pnpm --filter @shudeng/mobile test`。一个入口收集 `src/` 和 `plugins/` 下全部测试，分别交给现有 Node/Vitest runner；未知或混用 runner 的文件直接报错，避免静默漏跑。不再依赖 Core 的 node_modules 路径或手写 Vitest 类型声明。Node 使用 transform-types，以覆盖仓库已有的 TypeScript 参数属性；根目录声明的最低版本同步为支持该选项的 Node 22.7.0。

Mobile/Core 已开启 `noUnusedLocals` 和 `noUnusedParameters`。这能阻止未用局部和参数回流；导出是否仍有生产消费者继续按调用关系审查，不能仅靠编译器判断。

## 验收边界

最终统一验证：

| 检查 | 结果 |
| --- | --- |
| `pnpm test` | Core 260、reader-web 43、Mobile Node 326、Mobile Vitest 182，共 811 通过；Core 的 9 项 provider redirect 环境检查跳过。 |
| `pnpm -r typecheck` | Core、Mobile、reader-web、eval 全部通过。 |
| Agent 与 SQLite RAG 脚本闭环 | 各 3/3，通过受控模型验证工具/引用契约，未调用外网模型。 |
| 旧数据迁移脚本 | 18/18，含外键、移除书与损坏输入隔离。 |
| `git diff --check` | 通过。 |

整仓测试日志保留在 `.build/rn-ios/workspace-code-cleanup-tests.log`，最新构建日志复用 `.build/rn-ios/claude-mobile-build.log`，不累积重复构建目录。

最终 `scripts/build-ios-rn.sh Release` 构建通过（6676 个 Hermes 模块，模拟器 App 约 193 MiB），已安装并启动于 Small。实际截图确认书架、系统搜索与现有对话列表正常加载；证据为 `.scratch/reading-agent-acceptance/code-quality-launch.jpg` 和 `code-quality-conversations.jpg`。没有通过截图认定拖拽、键盘或按钮操作已验收。原生基线未改，未提交或发布。

收尾删除本轮重复的 Mobile 测试/Pods 日志及工具临时截图副本，释放约 0.2 MiB；保留最终统一测试日志、最新构建日志及两张运行证据。构建无 `tmp-*` 残留，可用空间约 41 GiB。历史 scratch、恢复资料、用户数据与其他会话文件未清理。

实现与独立复核分工进行。自动化结果证明相应状态和数据契约，不代表所有设备手势、键盘或真实模型质量已验收。正式发布不在本轮范围。

另记录一个既有窄时序风险：旧阅读器存在待写进度时删除书籍并立刻以相同 ID 重导，迟到写入可能覆盖新进度。此问题已用内存 SQLite 复现；真实设备触发条件未验证。完整修复需让阅读器写入绑定导入代际，本轮未扩展这套状态契约。
