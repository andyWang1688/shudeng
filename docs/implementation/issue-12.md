# #12 对话历史与重新取证追问

Fixed base: `b59da0c46b5f9e002baefd888c51b64c1a5ee369`。开发验证完成，尚未独立验收；不改变 #11/#14 WIP 判定。

## 对话存储与追问

沿用扁平 `reading-questions.json`，新增可选 conversationID、turnIndex、conversationTitle、history、retrievalQueries、evidenceScope，旧记录各自构成一段对话。每轮 UUID 稳定，首轮保留选文与原位置，追问创建新的草稿。改名仅修改首轮标题；删除先取消生成，再原子删除本对话所有轮次，token 校验阻止迟到响应复活。

历史按书分组、最近更新优先；对话页可回看历史回答及引用、继续追问。追问将此前问题回答用于独立的检索问题解析，最多四个 query 分别走真实混合检索，再合并新依据回答；历史答案不作为书内原文证据。所有历史计入原有 24KB 请求预算，超限拒绝，不静默裁剪。

## 显式允许范围契约

`QuestionStore.send(..., scope:)` 在任何追问解析或回答 HTTP 前核验 bookID、选文及邻文的真实位置，同时核验将进入历史的轮次来源（选文、邻文、发送证据和引用）。不允许先发送原文，再由回答取材阶段拒绝。取消检查保留在解析 HTTP 之前。

每轮持久保存 `evidenceScope`。历史回答可能转述原文，因此缩小范围时，不发送在更宽范围下生成的回答；旧记录未保存范围时按整书处理，不能用旧回答绕过新范围。拒绝后保留同一草稿 UUID，提示扩大允许范围或新建问题，无自动 HTTP 重试。原范围不变的显式 scope 可正常继续追问。

全书解析用的语言样本也在 SQL 中受 bookID／章节／段落范围过滤；没有允许样本时拒绝解析请求。候选评分、邻文扩展及最终证据继续沿用 `BookEvidenceScope`。本票不增加 #13 仅已读界面。

## 范围定向验证

iOS 26.5 iPhone 17 模拟器，原创 semantic-fixture、本地真实 SQLite／语义推理与 18772 可控 HTTP。宿主沿既有 XCTest 环境隔离，Keychain 使用随机测试 service；没有无参 simctl 启动。

- `testIssue12FreshEvidenceSwitchServiceAndScopeZeroHTTP`：最终 PASS，5.122 秒。覆盖原选文越界、历史回答范围过宽、独立选文校验、全书解析无允许样本四类拒绝，以及显式允许 scope 的成功追问。
- 原始结果：`/tmp/shudeng-issue12-scope-final2.xcresult`；附件与脱敏 HTTP 在 `.scratch/delivery/issue-12-evidence/`。日志共17条正常／容量测试请求，四个 `SCOPE12-NO-HTTP` 标记请求数为0；汇总 `scope-zero-http.json`。
- `testIssue12HistoryBudgetAndProviderCapacity`：PASS（前一最终范围测试包 `/tmp/shudeng-issue12-scope-final.xcresult`）。

以上不是 #12 全部用户路径验收；真实服务回答质量、真机、#13 交互和 #14 60秒后台承诺不在本次范围修复验证内。

## 最终定向验证

- `local-first2.xcresult` 1/1 PASS：真实 SQLite 路径目录故障、native 选文、明确选择局部解释、保存首问。
- 原 `history.xcresult` 1 FAIL 保留：恢复故障目录后未重启准备任务，等待资料可用超时。修复宿主顺序为恢复目录、显式 `simctl terminate` / `launch --isolated-reading-test`、XCTest attach；没有无参启动或产品修补。
- `history2.xcresult` 1/1 PASS，100.425秒：恢复追问、切换 Anthropic、两书三对话、改名、取消/确认删除、保存草稿。
- `offline.xcresult` 1/1 PASS，12.530秒：停本机假服务后显式隔离重启，回看两段历史、改名/删除结果、追问草稿和引用原文快照。复用同一隔离目录，未重新播种数据。
- `final-faults.xcresult` 3/3 PASS，14.384秒：真实追问 HTTP 返回时替换文件路径为目录，验证保存失败、同 UUID 重试及重载；真实管理写失败及恢复重试；追问生成中删除后等待慢响应，内存和重载盘记录均不复活。故障/并发分支以单测验证，未追加 UI 故障全排列。

结果包均在 `/tmp/shudeng-issue12-*.xcresult`；交付命令、附件、脱敏 HTTP、原业务 hash 与恢复记录在 `.scratch/delivery/issue-12.md` 及其证据目录。局部首问和恢复追问的同 conversationID 已冻结：首问不含 ch2-p1/p2，追问真实 HTTP 首次包含漏液事故及修订规则；假服务仅证明材料和协议链路，不证明模型回答质量。默认整书旧用例首问已含上述两段，不作为本项新增依据证明。
