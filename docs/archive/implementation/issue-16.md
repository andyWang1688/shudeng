# #16 移除原书与确认彻底删除

Fixed base：c9e0eca1514a41e306b0fc5e0119d25fa13d4d8d。继承 #14 最终有限后台契约，不改协议、超时、服务配置、Keychain、检索口径或后台策略。

- 默认移除只清应用内 EPUB 及本书派生 SQLite 行；保留 Book、阅读位置／设置／书签／已读章、笔记／高亮／草稿、问答和引用快照。书架长按选择“移除原书，保留记录”；书架“已移除”入口管理保留记录的书籍。笔记和历史仍离线可读、可编辑，返回原文明确不可用。
- “连同记录彻底删除”必须再次明确确认，取消不写数据、不取消任务。只清目标 bookID 的 Book、全部问答轮次／草稿／pending、应用内文件与派生行，其他书和共享配置／模型保留。外部 Files 文件不删除；不是磁盘安全擦除功能。
- 身份沿用文件字节 SHA-256。同字节重复导入或默认移除后重导，复用原 ID、进度及记录；同名但字节不同（包括重新打包）视为不同书，不猜测关联。彻删后同字节重导仍得相同 SHA，但得到新的 recordIdentity，不能恢复被删记录。旧书架 JSON 的可选字段缺省兼容。
- recordIdentity 只用于区分彻删前后的本机记录生命周期；Book ID 仍为 SHA。ReadingQuestion 保存对应 identity，QuestionStore 写入门禁拒绝旧实例／旧结果；追问沿用原 identity。LibraryStore 的进程内 revision 在移除意图落盘后失效，阅读位置、选文、旧笔记编辑器、书签 capture 返回及保存重试均检查旧 revision，阻止旧视图写入同 SHA 新书。
- 原书移除或意外缺失时，阅读／原文跳转／新生成／重新请求／追问不可用；UI 与 Store 都阻止 HTTP，不用残留 ready／SQLite 冒充原书可用。仅保存现有草稿或重试已取得答案的落盘不发 HTTP。重新导入同文件后恢复正常问答。
- 同书导入、恢复和移除互斥。移除先原子写 Book.removal（removing 或 deleting），再使旧 revision 失效、按书取消问答，取消并等待该书准备 task 退出。准备 progress／catch／末尾清理检查 token，不能覆盖新任务；正文初始化及向量初始化／提交检查取消。取消 A 不取消 B，也不结束 B 仍需的共享有限后台申请。
- 单书 writer 退出后，SQLite 在一个事务内按 book_id 清 embeddings、embedding_progress、fragment_terms、fragments、chapters、preparations、contents；不删共享数据库、不手工清 FTS shadow 表。随后清本书应用内 EPUB，彻删再原子移除本书全部问答，最后原子提交 removed 或删除 Book。默认保留路径先确保 pending 内容能够保存，保存失败不丢弃后报成功。
- JSON、SQLite、文件没有跨介质事务。中途失败可能已有部分清理：界面提示尚未完成，保留 intent 并允许重试，不声称完整回滚。启动恢复 pending intent 后才启动正常书籍准备，失败保留“已移除”中的重试入口；导入不能越过待完成 intent。删除不存在的文件／索引行可幂等继续；对话加载失败不能作为空库覆盖。

定向开发测试、真实存储故障、延迟 HTTP 与 UI 实际结果见 .scratch/delivery/issue-16.md；不把开发通过等同独立验收。真实设备、真实 AI 服务、最低 iOS16 未验证；继承既有阅读定位和 Keychain 基线，不重跑无关组合。
