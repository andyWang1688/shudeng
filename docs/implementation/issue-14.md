# #14 有限后台与中断恢复（WIP，60秒验收未达）

基线 `18c9e2e833036a33fefbe65ed44c67dab1c2613e`。继承 #11 WIP，不修改自由提问、整书取材、范围和协议；不新增服务器、远端任务编号、BGTaskScheduler、后台 URLSession 或自动重发。

## 实现契约

`LibraryStore.questions` 持有应用级 `QuestionStore`，关面板仍只 dismiss。Store 在请求准备保存后申请一个 UIApplication 有限后台任务，覆盖取材、HTTP、核验和原子保存；多个在途请求共用该申请。离开前台时有请求则按需申请，进入后台若申请无效则中断；回前台释放申请但不取消请求，再次离开时按需申请。

系统 expiration handler 使当前 jobs 失效并取消，保存 incomplete 后及时释放；成功、失败、主动取消、最后一项任务退出均清理申请。申请 token 排除旧过期回调，原请求 token 与取消检查排除旧结果/清理覆盖新请求。没有60秒定时器；回答 HTTP 仍为原90秒超时。#11 既有拆解请求仍30秒，只新增返回后的取消检查，不扩其取材。

沿用稳定记录 UUID、原子 JSON revision、pending 与保存失败 UI：答案、核验引用、complete 一起提交，失败显示尚未保存；重试保存不发 HTTP。重启将遗留 preparing/generating 改为 incomplete，主动重新请求才产生新 HTTP，不冒充远端续传。存储始终失败时最后一次 pending 不保证重启恢复。

OpenAI Chat Completions 与 Anthropic Messages 仍 `stream:false` + `URLSession.data(for:)`：完整响应返回前无可保存答案片段，网络收到的零散字节不等于应用已取得文字。实际可恢复的是已提交问题、原文/发送材料、状态；已取得但保存失败的完整结果可在当前进程重试保存。截断/错误协议仍沿用原契约。

DEBUG 隔离启动使用独立 Keychain service `dev.shudeng.ai-services.isolated-reading-test`，避免隔离配置的孤儿密钥清理影响正式 service；不重置 Keychain。仅隔离启动或 XCTest 写 `question-lifecycle.jsonl`，记录时间/事件/UUID/轮次/applicationState，不记录问题、密钥、地址或鉴权头。

## 验证结论

环境：iPhone 17、iOS26.5模拟器、受控HTTP `127.0.0.1:18774`，非流式。四个请求各一次；使用既有 search-fixture 真选文、既有选文检索路径。没有调用 #11 全书拆解。与准备计划的局部解释输入有区别：已就绪样书使用实际选文取材，原文材料完整保存在证据中。

| 用例 | 实际结果 |
| --- | --- |
| Anthropic20 | 后台接收、原子提交答案+E1+complete；原UI用例之后状态断言失败；离线重启补验通过，不重发。 |
| OpenAI20 | 后台接收、原子提交答案+E1+complete；原UI用例之后返回书架定位失败；离线重启补验通过，不重发。 |
| Anthropic60 / OpenAI60 | FAIL：进入后台后约26.37秒真实系统过期，保存incomplete并释放；服务60秒响应未提交。不能算60秒后台完成通过。 |
| 离线重启 | 假服务停止后4条记录各唯一：两条20秒完整回答可读，两条60秒明确系统中断，UI方法通过。 |
| 真实终止 / 主动重试 | preparing阶段实际终止进程，重启显示中断、空答案；主动重试同UUID完成且仅一条记录，两个UI方法通过。此终止发生在取材阶段，不能冒充HTTP已发送后的强杀。 |
| 网络/注入过期/迟到结果 | 3个定向集成方法通过；真实HTTP断开保留问题、注入中断立即重试无重复且旧结果不覆盖；注入过期不替代上述真实系统过期证据。 |
| 后台真实写失败 | 仅隔离问答文件替换为空目录，后台收到完整结果后真实原子写失败；前台显示保存失败和答案，恢复文件后重试保存成功；HTTP只有一次，UI方法通过。 |

有限后台申请在进后台前约2.70—2.87秒发生；两个60秒请求均在后台开始HTTP，约26秒后expiration。未发现前台长时间等待耗尽配额的证据；未采集 backgroundTimeRemaining，不能补造。没有靠反复申请延长配额，也没有修改模拟器后台限制。60秒首条验收仍未达，因此只交WIP，不能关闭#14。真机/真实服务/最低iOS16均未验证。

实际命令、PID、绝对时间线、方法结果、xcresult与恢复记录见 `.scratch/delivery/issue-14.md`；截图、HTTP原始响应、故障前后文件、业务哈希及原始命令日志见 `.scratch/delivery/issue-14-evidence/`。只继承#9引用/Keychain/原子保存既有证据，不称重跑其全套。
