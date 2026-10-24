# Issue #32：整应用视觉验收与 Release 验证

状态：2026-10-25，最终聚焦验收完成；所有 #23 子 Issue 的页面实现已关闭，整应用 Release 按用户约定的模拟器标准完成本轮验收。未创建新版本、未推送、未修改父 Issue。

## 最终结果

- 最终聚焦套件：`.scratch/test-evidence/issue32/final-focused-3.xcresult`，30 tests / 0 failures（DesignFixtureTests、QuestionPresentationTests、#24–#31 应用级用例）。
- 串行运行曾发现 #27 应用级用例受前一页状态影响；定向复跑只读定位并修正测试隔离后，`.scratch/test-evidence/issue32/issue27-rerun3.xcresult` 为 1 test / 0 failures，完整聚焦套件也达到 30/30。
- Release 构建：`.build/issue24-derived/Build/Products/Release-iphonesimulator/Shudeng.app` 构建成功；对生产二进制检查 `design-fixture`、`DESIGN_FIXTURE_ROOT`、`ShudengDesignFixture` 均无命中。
- 唯一设备仍为 Shudeng Small（iPhone SE 3，iOS 26.5，`1B9B9A35-F2D7-4D87-AB31-6B07D1B27D66`）；未新增模拟器。
- Release 包已安装并正常启动；书架仍有原 3 本书，未删除或重建书库。最终启动截图见 `.scratch/test-evidence/issue32/final-release-shelf.png`（含本机用户数据，不提交公开仓库）。
- 构建前可用磁盘约 40 GiB；最终构建目录位于 `.build/issue24-derived`，未复制持久依赖到系统临时目录。

## 页面覆盖

| 页面 | 证据 |
| --- | --- |
| 固定夹具与四栏外壳 | `DesignFixtureTests`、`final-focused-3`、[#24](../2026-10-23/visual-acceptance.md) |
| 书架 | [Issue #25 验收](issue25-shelf-acceptance.md)，375/390、浅深色、空/搜索/准备中、Dynamic Type |
| 笔记 | [Issue #26 验收](issue26-notes-acceptance.md)，四类过滤、分组、空态、返回原文 |
| 对话 | [Issue #27 验收](issue27-conversations-acceptance.md)，搜索、分组、空/失败、打开对话 |
| 我的 | [Issue #28 验收](issue28-profile-implementation.md)，品牌区、服务/外观/许可、未配置与 XXXL |
| 阅读与选文 | [Issue #29 验收](issue29-reader-implementation.md)，两尺寸浅深色、三种模式、书签、菜单 |
| 问答面板 | [Issue #30 验收](issue30-question-panel-implementation.md)，76% 面板、身份、附件、输入、状态 |
| 引用原文与返回 | [Issue #31 验收](issue31-citation-implementation.md)，高亮、返回问答、连续引用、失败退出 |

## Release 结论

按用户 2026-10-21 确认的标准，本轮以当前源码的模拟器 Release 聚焦验收作为正式发布测试通过依据：页面视觉矩阵通过、聚焦回归 30/30、Release 构建成功、唯一模拟器安装后正常启动。

这不是 App Store 上架、真机、签名归档或完整历史测试集验收。本轮未创建 GitHub Release、未推送提交，既有 v0.1.0 资源未改。

## 保留边界

1. 完整旧单元/UI 套件没有在正确环境重新全量运行；历史失败仍不能视为通过。
2. 未执行完整 VoiceOver 手工顺序、所有辅助字号组合、真机性能、App Store 分发或真实 AI 回答质量验收。
3. 390 × 844 使用同一测试进程的固定内容尺寸渲染；375 × 667 使用唯一 Shudeng Small 模拟器。
4. 含真实书库和历史内容的截图只保存在本机 `.scratch`，不上传 GitHub。
