# #14 三项定向补验交付

Fixed base：`6b1ea3ca16fca6cfab11297ab9ef1ed8bac5ef8d`。本报告与 LibraryStore/UI 测试同一提交；fixed final 完整 hash 见 `issue-14-followup-evidence/fixed-final.txt`。提交范围仅 LibraryStore、ReadingUITests、实现说明和本交付文档。未修改 Issue、监督文件、ADR、README 或旧交付报告；未 push、未关票。以下为执行证据，最终结论交主控独立验收。

## 环境与边界

仅 QA9FA `9FAEC8B6-6E69-4E0B-A4D1-115C85C6D48E`，iOS 26.5、隔离目录 `tmp/ShudengReadingTests`，Keychain service `dev.shudeng.ai-services.isolated-reading-test`。A1 与 Small 未操作。沿用 ephemeral、拒绝重定向、系统 TLS 校验、90 秒回答超时；没有 background upload、服务器或远端任务编号。未重跑两格式20/60矩阵；60秒被系统中断时可靠保存问题、标记未完成并允许主动重试的有限后台契约按本次授权验收。真机、真实服务及最低iOS16仍未验证。

根因：原 `LibraryStore.questions` 为 lazy，启动停在书架时不会运行 `QuestionStore.load()`，盘中 generating 记录要等访问问答后才恢复；改为在 LibraryStore 初始化时创建，启动即执行已有的 incomplete 恢复。仅改变初始化时机，无问答粒度、检索、权限或网络协议变更。

## 结果与原始证据

所有路径以下均相对 `issue-14-followup-evidence/`；三个目标 UUID 在各自最终盘快照中均唯一，答案 `BG14-OpenAI-20`、引用 E1、state complete。`verified-final-summary.json` 为原始文件聚合检查，`summarize-final.rb` 可重复核验。

| 补验 | UUID / 句柄 | 实测结果 |
| --- | --- | --- |
| HTTP在途终止、书架重启恢复、主动重试 | A0D247F7-0C99-4EB7-A9F7-AFBA0C4BE2A8；26307 exit0 | 重启稳定后 incomplete、空答案；精确历史行主动重试，UI选择bg-20服务；同UUID完成。重试HTTP请求/响应各1。 |
| 后台真实保存失败、仅重试保存、真实终止、离线重启回看 | B98186B6-C6E1-415D-B18A-FA87FA05E46A；78151/5555均exit0 | 后台完整结果真实写失败，前台显示未保存；恢复文件后重试保存，未新增HTTP；关闭fixture后真实终止/重启，答案和引用可读。 |
| 关闭问答面板后继续阅读、后台完成 | ED11CCBC-526E-4312-9C90-E46D5E4F38DF；55011 exit0 | S1-SECOND y=456→1171；章节Locator progression 0.74554707379134855→0.38167938931297712。随后Home，后台接收并提交complete；HTTP请求/响应各1。 |

### HTTP在途链

`http-chain.jsonl`：原bg-120请求服务收到时间1792150654.417446；`chain-pre-terminate.json` 为generating；真实终止完成1792150718.335560，重启1792150718.567955。`chain-post-restart.json` 立即读盘仍generating，属于启动尚未稳定，不能作为已恢复证据；`chain-post-restart-settled.json` 在1792150771.797549采样为incomplete、空答案、提示“上次生成已中断，请主动重试。”。不承诺紧接launch返回即可读到恢复状态。

主动重试测试用 `question-A0D247F7-0C99-4EB7-A9F7-AFBA0C4BE2A8` 精确定位，UI新增并选择bg-20再发送。原bg-120延迟用于确保强杀在HTTP在途；重试是新请求，不是原请求续传。`http-retry-final.jsonl` request1792151738.6549141、response1792151758.657185；`retry-final/reading-questions.json` 同UUID complete+E1。`chain-retry-final.log`、`attachments-retry/manifest.json`；xcresult `/tmp/shudeng-issue14-chain-retry-final.xcresult`。

### 保存失败和真实离线重启

`background-fault-final.rb` 仅把隔离问答文件临时换为空目录，并在观测saveFailed后自动还原；`background-fault-final.jsonl` 记录fault-installed1792151922.007605、save-failure-observed1792151942.092683、fault-restored1792151942.0935931。原始revision在 `before-background-fault-final.json` 和 `during-background-fault-final.json`。生命周期request/received/saveFailed均applicationState2，complete提交1792151948.621655为前台重试保存。

`http-save-final.jsonl` 只有request1792151921.967314和response1792151941.975232；重试保存没有第二次request。fixture停止后，1792151968.6205041发出terminate，1792151969.263732重新launch完成（新PID81859），参见 `save-restart-times.jsonl`。`offline-port-check.txt` 为空对应lsof退出1、无18774监听。`save-final-before-terminate/`、`save-final-terminated/`、`save-final-offline-restarted/` 保留同UUID完整盘状态，后一生命周期没有新增request。

`save-final.log`、`save-offline-final.log`；`attachments-save/manifest.json`、`attachments-offline/manifest.json` 与 `save-offline-final.png`。UI断言答案文本及引用按钮；截图初始视口仅显示保存状态，答案/引用的断言与盘证据另有记录，不能仅靠该截图判定完整性。xcresult `/tmp/shudeng-issue14-save-final.xcresult`、`/tmp/shudeng-issue14-save-offline-final.xcresult`。

### 面板关闭、实际阅读移动、后台提交

`reading-final2.log` 在面板关闭后打印marker真实frame并向下滑动回读前文；`reading-final2-before/` 与 `reading-final2-after/` 保存library.json，两个Locator同章但progression改变；`reading-final2-before.png` / `after.png` 及 `attachments-reading/manifest.json` 可见S1-SECOND/INLINE退出视口，原文继续显示。

`http-reading-final2.jsonl` request1792156078.066447、response1792156098.0684512；`reading-final2-saved/question-lifecycle.jsonl` didEnterBackground1792156085.351098、received1792156098.0717611、committed-complete1792156098.1793861，后两项均applicationState2；回前台1792156109.232307。引用E1仍指原选文，阅读滚动没有改变问答材料。xcresult `/tmp/shudeng-issue14-reading-final2.xcresult`。

## 测试工具修正与失败轮次

旧chain-retry/2/3/4分别存在同名多记录、环境变量未传递、手工xctestrun结构导致Xcode异常；均不算通过。最终取消环境变量依赖，固定本证据UUID，重新build-for-testing生成runner；产品不为runner修改行为。bg-120超过现有90秒回答超时，最终正常UI选择bg-20服务用于主动重试。

`save-fault.log` 旧轮次未成功观察保存失败，不算通过；最终仅修正前台“书架”按钮定位并使用唯一题名。`reading-final.log` 首轮exit65，S1-SECOND靠近章末，向后滑动无有效位置变化；最终改为向前回读并同时采集marker位置、截图和持久化Locator，`reading-final2.log` exit0。所有失败日志保留。

## 构建与执行

构建日志 `build-retry-fixed.log`、`build-save-final.log`、`build-reading-final2.log` 均为TEST BUILD SUCCEEDED（后者含最终产品和测试）；DerivedData `/tmp/shudeng-issue14-followup-derived`，依赖缓存 `/tmp/shudeng-readium-spm`。初次无沙箱外缓存写权限的exit74保留，不当作编译失败根因。

```sh
xcodebuild -project ios/Shudeng.xcodeproj -scheme Shudeng \
  -destination 'platform=iOS Simulator,id=9FAEC8B6-6E69-4E0B-A4D1-115C85C6D48E' \
  -derivedDataPath /tmp/shudeng-issue14-followup-derived \
  -clonedSourcePackagesDirPath /tmp/shudeng-readium-spm -disableAutomaticPackageResolution \
  -parallel-testing-enabled NO -collect-test-diagnostics never \
  CODE_SIGNING_ALLOWED=NO ENABLE_DEBUG_DYLIB=NO \
  'OTHER_LDFLAGS=$(inherited) -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __entitlements -Xlinker /Users/wangxinxin/work/projects_pycharm/shudeng/.scratch/delivery/issue-14-evidence/entitlements.plist' build-for-testing

xcodebuild -xctestrun /tmp/shudeng-issue14-followup-derived/Build/Products/Shudeng_iphonesimulator27.0-arm64.xctestrun \
  -destination 'platform=iOS Simulator,id=9FAEC8B6-6E69-4E0B-A4D1-115C85C6D48E' \
  -parallel-testing-enabled NO -collect-test-diagnostics never \
  -only-testing:ShudengUITests/ReadingUITests/testIssue14ClosePanelContinueReading \
  -resultBundlePath /tmp/shudeng-issue14-reading-final2.xcresult test-without-building
```

其他三个only-testing方法、完整命令与各自resultBundlePath见上列原始测试log。测试依赖harness先simctl terminate/launch `dev.shudeng.app --isolated-reading-test`，XCTest仅attach。故障和终止阶段为外部harness操作，不能单独跑UI方法冒充完整链。

## QA释放

fixture55819已SIGINT退出130；watcher30036/61064 exit0。QA9FA应用已真实terminate。`isolation.rb restore 9FA...` exit0，changed business files=[]，原隔离目录已还原，light/large已恢复，测试目录保留为 `ShudengReadingTests-issue14-followup-evidence`。正式业务目录前后均空（baseline和changed-business-files证据），未读取原业务Keychain明文；Keychain边界由DEBUG隔离service源码保证，不把未执行的Keychain逐项哈希当证据。QA9FA已释放；A1、Small保持原状。
