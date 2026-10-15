# #4 目录与书签导航

- 阅读工具栏的列表按钮打开目录／书签；目录保留层级、可滚动，空目录与读取失败明确显示。书签页右上角添加当前可见原文，点击回看，左滑移除。系统辅助字号下设置使用齿轮图标并保留“阅读设置”无障碍名称，按钮保持可点击宽度。
- 沿用 UIKit / Readium 3.11.0 与 `library.json` 原子提交。`Book.bookmarks` 可缺省，兼容旧记录；写成功后才发布内存与成功提示，操作不改写阅读设置或其他书籍。新增／移除失败保留已提交列表，弹窗可重试或取消；重启只恢复已提交记录。
- 书签 UUID 在第一次捕获时生成，同一次重试复用；同书、同资源、同 CSS 元素范围和相同 `before/highlight/after` 去重，忽略排版变化后的 progression 差异。按添加顺序展示，保存章节标题与短原文快照。不按屏幕页码去重，不合并不同章节或不同出现位置的相同句子。
- 保存完整原生 Locator，并补充当前屏内首个完整可见字符的元素范围和前后文。没有可确认文字位置时明确提示无法添加，避免伪造位置。日常进度仍保存导航器报告的原生 Locator，书签锚点不替代日常进度格式。
- 目录和书签共用跳转核验：先要求资源在 reading order 内，再调用 Readium；随后检查当前资源，以及目标元素中的准确字符是否进入可视区域。文字核对限定原元素并使用完整前后文，防止重复句错位。目录无 fragment 时核验资源开头，有 fragment 时核验对应元素。`go()` 返回成功不代表通过；核验期间及失败后不提交临时进度，失败提示重新选择目录／书签。有效目标恢复操作并保存实际位置。
- 保留原有分页、滚动、字号、明暗主题、工具栏显隐与位置保存。无卷页、书内搜索、高亮笔记、AI、依赖或正式打包资源变化。

## 验证入口

存储测试在 `LibraryTests.testBookmarksSurviveRestartAndFailedMutationsRetryWithoutDuplicates`，正式 UI 用例在 `ReadingUITests` 的 `testContentsAndBookmarkReturnAfterRestart`、`testChapterEndsRepeatedTextReflowAndInvalidTargets`、两项 `testBookmark…FailureAndRetry` 和 `testNavigationSmallScreenLargeText`。

新增 `navigation-fixture.epub` 由 `ruby scripts/create-navigation-fixture.rb` 从原创三章样书生成，只改目录，含嵌套章末入口、无效 fragment 与缺失章节负例；不进入正式应用资源。UI 导入沿用 Files 中的 `Acceptance` 文件夹。故障用例使用真实 `library.json` 文件写保护，由 `scripts/verify-save-failure.sh` 动态获取容器并自动恢复；移除故障用例紧接新增故障用例运行，使用已保存书签。

本地交付证据与实际命令见 `.scratch/delivery/issue-4.md`。测试覆盖 iOS 26.5 模拟器及小屏最大辅助字体；真机、iOS 16、长书性能、复杂 CSS／RTL／竖排／无文字图片页仍未验证，不代表整项首发产品独立验收完成。
