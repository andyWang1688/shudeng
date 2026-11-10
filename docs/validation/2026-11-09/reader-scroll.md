# EPUB 滚动与阅读手势复核

任务：[GitHub #59](https://github.com/andyWang1688/shudeng/issues/59)。源码为 `codex/ui-product-integration`、HEAD `d663a77` 加当前工作区；保留既有未提交修改，本轮未提交或发布。验收只操作 Small 的独立开发包 `dev.shudeng.integration`（书灯·开发），iPhone SE 第三代、iOS 26.5、375×667。

## 问题与修复

用户截图的 `search-fixture` 第 2 章是最后一章：实际 EPUB spine 只有 ch1/ch2，压缩包里的 ch3 不在 manifest/spine 中。第 2 章在 125% 字号下高度约 476 px，视口 647 px；滚动设置确已生效，书末上滑没有位移是正确边界，不能把这次观察写成设置失败。

另以长篇 `Pride and Prejudice` 实测复现了真实缺陷：引擎已为 scrolled、正文存在溢出，但在章节底部继续真实上拖后仍停在原章节。原生滚动本身可用，未修改 WKWebView 的 isScrollEnabled。

修复仅在手势开始和结束都处于同一章节边缘时，复用 Foliate 的 prev/next；章内仍使用系统滚动与惯性。选文、双指、取消、横向偏移及书籍起止不翻章。字号、模式、原文导航和引用到达使旧手势失效，正文变长及文档替换在松手时重新核对。滚动模式点按正文显隐工具栏，避免左右区域点按误翻。

移动端不再因更改一个设置同时发送 theme/fontSize/flow 三条命令。open 携带初始设置，ready 只补发加载期间的变化；后续只发变化项。切书和 PDF 实验入口的初次同步分别保留。该改动减少无关原生缓存刷新，没有声称测得帧率提升。

## 当前验证

所有滚动位移来自真实触控；调试桥仅调用只读 getState 和 renderer 几何属性，不调用 harness.flow、next 或 scrollTo。测量见 [设备记录](reader-scroll-device.json)。

| 输入与操作 | 当前结果 |
| --- | --- |
| 真实上拖后再下拖长章节 | 通过；最终包 start 从 2379 到 5859，再回到 1681，正文 CFI 同步变化。 |
| 长章节底部继续上拖 | 通过；修复前仍是 `/6/4`，修复后及最终包进入 `/6/6`，新章 start=0。 |
| 分页→仿真→真实横向卷页→滚动 | 通过；卷页 start 从 1041 到 1388，切回后 flow=scrolled。 |
| 滚动调整至 125% 字号并退出重开 | 通过；fontSize=23.125，重开前后 CFI 均为 `epubcfi(/6/6!/4,/24/1:23,/26/3:87)`。 |
| 用户截图同一短末章上滑 | 正确保持原位；正文不足一屏且没有下一章，不将其记为跨章失败。 |
| 原书第 2 章下滑，再从第 1 章末尾上滑 | 通过；`/6/4`→`/6/2`→`/6/4`，标注数量保持 2。 |

`pnpm --filter @shudeng/reader-web test`：53 项通过，包含新增 10 项滚动回归。`readerPreferenceCommands.test.mts` 与既有 `readerSettingsPersistence.test.mts` 合计 11 项通过。reader-web、mobile 类型检查及 diff 检查通过。新增回归在修复前能检测章边界不前进；独立复查发现并补齐了重排及引用导航期间的旧手势问题。

## 安装与范围

复用现有 Release 原生底包，重新生成内联 EPUB 资源、产品 JS 与资产，签名并安装独立开发包；没有大型原生构建，不覆盖正式包、原生对照或 Demo。长篇样书通过系统导入进入开发包，原有书籍和标注保留。

最终来源 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| epub-reader.ts | `3cb07ffb2380212d9535dade7f0204251441663ae2d9ec32a438ae047797935b` |
| ReaderWebView.tsx | `10fde562dac142896f2fe1647ecfefda950aa72c88984e37c1d32be47e65ea20` |
| readerWebHtml.ts | `2d26a73db75f82564154c025746add68546b3a1c93b6883ea9c7cc01b262c596` |
| 安装 JS bundle | `08607b0f3d247c27df56ae7fc6f08702cf6de6658a0bf9d81d5bf1669da41922` |

未验证：真机、Android、竖排 EPUB、VoiceOver、性能剖析和长时间阅读。跨章是在边缘继续拖动后切换章节，未将整本书同时铺成单一长页面。其他基准缺口仍按 [11 月 8 日基准复核](../2026-11-08/product-baseline-audit.md)跟踪，不因本次通过视为整体产品达标。
