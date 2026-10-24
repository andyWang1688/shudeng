# Issue #25：书架与共享外壳验收

状态：2026-10-24，书架与四栏共享外壳通过本轮约定范围的视觉验收。它不代表笔记、对话、我的、阅读、问答和引用页面通过。

基准：[高保真原型](standalone.html)、[设计规格](spec.md)、[UIKit 界面开发规范](../ui-development-standard.md)。执行单：[GitHub Issue #25](https://github.com/andyWang1688/shudeng/issues/25)。

## 结论

- 375 × 667 与 390 × 844 的浅色、深色固定尺寸渲染均通过书架结构对照。
- 四栏使用自定义平直底栏，保留 `tab-library`、`tab-notes`、`tab-conversations`、`tab-profile` 测试接缝；选中标记、图标、文字和 81pt 高度由同一共享外壳提供。
- 书架包含品牌行、左对齐 31pt 页头、44pt 圆形导入入口、搜索、完整继续阅读卡片、两列书库和阅读状态。
- 正常、空书架、搜索无结果、资料准备中四种状态均有 Shudeng Small 应用级截图；准备中仍可从继续阅读打开原文。
- Dynamic Type 辅助字号下书库改为单列，内容可滚动；品牌、页头、导入、搜索、继续阅读和四栏入口均保留。

## 证据

最终源码：HEAD 见本次提交；测试结果 [final7.xcresult](../../../.scratch/test-evidence/issue25/final7.xcresult)，日志 [issue25-final7.log](../../../.scratch/issue25-final7.log)。

- 单元验收：5 tests / 0 failures，包含 16 张固定尺寸四栏渲染、空与准备状态、Dynamic Type 单列断言。
- 应用级验收：2 tests / 0 failures。四栏切换、书库卡片打开阅读、继续阅读打开阅读、搜索无结果、空书架、准备中打开阅读均实际执行。
- 本目录 [curated](../../../.scratch/test-evidence/issue25/curated/) 保留最终截图；其他页面的固定尺寸截图仍只作为待返工基线。

关键对照：

| 状态 | 证据 |
| --- | --- |
| 设计基准 375 × 667 | [design-shelf-375.png](../../../.scratch/test-evidence/issue25/curated/design-shelf-375.png) |
| 375 × 667 浅色 / 深色 | [浅色](../../../.scratch/test-evidence/issue25/curated/shelf-375x667-light.png) / [深色](../../../.scratch/test-evidence/issue25/curated/shelf-375x667-dark.png) |
| 390 × 844 浅色 / 深色 | [浅色](../../../.scratch/test-evidence/issue25/curated/shelf-390x844-light.png) / [深色](../../../.scratch/test-evidence/issue25/curated/shelf-390x844-dark.png) |
| 应用级正常 / 搜索无结果 | [正常](../../../.scratch/test-evidence/issue25/curated/app-shelf-375-light.png) / [搜索无结果](../../../.scratch/test-evidence/issue25/curated/app-search-empty-375-light.png) |
| 空书架 / 资料准备中 | [空书房](../../../.scratch/test-evidence/issue25/curated/app-shelf-empty-375-light.png) / [准备中](../../../.scratch/test-evidence/issue25/curated/app-shelf-preparing-375-light.png) |
| Dynamic Type XXXL | [单列与可滚动布局](../../../.scratch/test-evidence/issue25/curated/shelf-accessibility-xxxl.png) |

应用级截图已裁除 20pt 系统状态栏，不把状态栏差异计入对照；固定尺寸图由真实 UIKit 页面控制器渲染，不是缩放截图。

## 已核对的实现

1. `RootTabController` 只安装当前栏目，并在切换时完成子控制器 appearance 生命周期；四栏状态和导航栈由同一控制器对象保留。
2. `RootTabBar` 使用纸白底、1pt 顶部分隔线、四等分按钮、23pt 图标、10pt 标签和 19 × 3pt 暖灯选中标记，不使用系统悬浮 Tab Bar。
3. 书架页头不依赖系统大标题容器；品牌行、页头、导入、搜索和继续阅读均为插件的稳定可访问入口。
4. 继续阅读整卡可点击；封面、书名、作者、章节/百分比、进度线、“接着读”和圆形箭头均存在。
5. 书库保持两列封面比例；真实内容换行时标题和作者增高，辅助字号时改为单列。
6. 标题排版回退封面优先使用一致的纸书色、书名和作者；真实 EPUB 封面优先，缺失时不伪造出版社封面。

## 允许差异与边界

1. 固定夹具的章节名与 12% 进度比设计示例文字更长，属于真实内容换行。
2. 390 × 844 是同一测试接缝内的内容尺寸，不是设备截图；系统状态栏和 Home Indicator 不计入像素对照。
3. 辅助字号下继续阅读卡片增高并需要滚动，书库改为单列；没有删除品牌、页头、导入、搜索或四栏入口。
4. 本轮未验证带真实内嵌封面的 EPUB、完整 VoiceOver 顺序、真实 AI 回答质量、完整旧测试集或整应用性能。#32 才负责整应用与 Release 收尾。

## 后续

书架通过的证据只更新书架和共享外壳。下一张单从笔记页继续，其他页面仍保持原验收矩阵中的未通过状态。
