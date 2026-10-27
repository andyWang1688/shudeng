# 覆盖式阅读控件

状态：2026-10-26 用户已选择；专用模拟器的功能与性能验收通过。依据 [ADR-0013](../../adr/0013-fixed-reading-viewport-overlay-controls.md)。

[交互示意](reader-overlay-controls.html)用于说明固定正文与控件显隐关系，不作为原生性能证据。沿用现有 51pt 顶部工具栏、66pt 底部信息和提问入口，以及纸白、墨色、暖灯色令牌。正文始终铺满安全区，工具栏在前层覆盖；不扩大正文边距来永久躲开控件，不更换阅读内核或翻页模式。

| 操作 | 预期 | 禁止 |
| --- | --- | --- |
| 点击阅读区中部 | 顶部、底部、问答入口一起淡出；正文不动 | 重建阅读器、重新分页、转圈或先禁用正文等候 |
| 再点中部 | 相同控件淡入，完成后可操作 | 改变字符位置、缩放旧卷页图当作新内容 |
| 连续快速点按 | 以最新显隐意图收敛，动画可打断 | 旧动画完成回调反向隐藏新控件 |
| 隐藏时触控、VoiceOver | 控件不拦截；提供显示工具栏动作 | 透明控件仍吃掉正文手势或隐藏入口无法恢复 |
| 减少动态效果 | 直接切换，无位移或缩放 | 因关闭动画改走阅读器重建 |
| 旋转、改字体/主题、翻页、选文、引用返回 | 保留既有精确原文焦点、取消翻页和保存合同 | 只验证最终控件而漏掉阅读操作 |

验收从 ReaderController 收到点按计时：控件完成布局与响应不超过 250ms，确认真实正文仍可交互不超过 350ms；三种模式均无新增阅读器实例、无加载阶段。时间值必须记录实际测量，不从动画 duration 推断。每次检查独立 DOM 原文字元、正文原生视口及位置，保留浅/深色截图和前后证据。

原 #37 中“显隐前后正文高度增长 117pt”的断言由用户此次选择取代，改为正文始终满屏且 frame 不变；旋转、字号、关闭重开、引用返回的原文位置要求保留。


## 验收进度（2026-10-26）

原行为在同一专用 SE3 / iOS26.5 QA 上精准复现，点击处理开始至 fresh DOM 与正文可交互的耗时如下：

| 模式 | 隐藏 | 显示 | 点击路径副作用 |
| --- | --- | --- | --- |
| 分页 | 1186.7ms | 1195.2ms | 每次重建 navigator、进入 loading |
| 滚动 | 1200.8ms | 1483.8ms | 每次重建 navigator、进入 loading |
| 仿真翻页 | 3381.7ms | 4408.9ms | 每次重建 navigator、进入 loading 和 curlBusy |

证据：本地 .build/toolbar-latency-evidence/baseline-ready.log 与 baseline-ready.xcresult。最初两次新模拟器测试启动失败没有运行用例，不作为性能数据。

清理临时诊断代码后的三种模式均已通过实际点按、连续五次点按、隐藏后真实翻页/滚动、恢复后打开设置，以及视口和原文字元坐标不变的检查：

| 模式 | 隐藏控件完成 | 隐藏后 fresh DOM 可用 | 恢复控件完成 | 恢复后 fresh DOM 可用 |
| --- | --- | --- | --- | --- |
| 分页 | 210.0ms | 222.7ms | 232.4ms | 262.6ms |
| 滚动 | 210.4ms | 223.5ms | 230.9ms | 243.2ms |
| 仿真翻页 | 211.0ms | 237.2ms | 217.6ms | 252.0ms |

计时从应用收到激活回调开始，控件完成与新 DOM 采样分别记时；XCUITest 调用本身还包含测试框架的等待，不当作用户触摸耗时。三种模式的显隐均没有 navigator 重建、loading、curl 启停或预取阶段。最终证据为 overlay-final-regression.log / overlay-final-regression.xcresult（6 项、0 失败）。

仿真翻页的额外故障也已修复。curl-hit-test-events.log 记录：旧拖动有 down/move，却没有 up/cancel；翻页后 hitTest 落在 live WKContentView，各祖先均可交互，新点按的 down/up 也已到达 Readium。其 ActivatePointerObserver 因旧 pointer 仍保留在 failed 集合而不再发出激活回调。应用现在通过 Readium 公开接口管理 curl 专用激活观察器，在 busy 时注销、成功或取消后重建、stop 时清理；旧 delegate 点击路径在 curl 模式跳过，避免重复处理。没有修改 Vendor 或加全屏触控拦截层。

overlay-final-targeted.log / overlay-final-targeted.xcresult（3 项、0 失败）覆盖浅/深色真实长按与笔记、仿真模式旋转、两轮前翻/取消/后翻、深色放大字号、关闭重开后的原文字元。清理后 6 项回归还覆盖普通分页/滚动的旋转和重开、引用返回，以及上述三种模式计时与隐藏态真实输入。浅/深色最终截图位于 final-curl-focus/。独立代码审查未发现覆盖布局或观察器生命周期的阻塞缺陷。

首轮 overlay-green 与后续诊断失败证据保留。Reduce Motion 与 VoiceOver 目前仅代码检查，未做运行验收；本次没有真机或真实 AI 请求验收。

## 交付

2026-10-26 已完成 Release 构建、包审计和严格签名检查，并覆盖安装到用户原来的 Shudeng Small 模拟器。新旧包的 simulator application identifier 同为 `9J638ZYKM2.dev.shudeng.app`，未引入显式 Keychain 组。覆盖安装使系统重新分配了数据容器路径；查询新路径后核对 7 个业务文件（书籍、索引、进度、问答与 AI 配置），字节数与 SHA256 均与安装前一致。应用启动成功。

[#37 最终验收记录](https://github.com/andyWang1688/shudeng/issues/37#issuecomment-6414890740)已发布，Issue 已关闭；整体视觉地图仍保留后续用户体验验收。
