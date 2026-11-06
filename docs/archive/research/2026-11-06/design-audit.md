# 界面设计审计：为什么“功能有，但不像真实产品”

状态：审计与建议稿，待用户确认；未改任何实现。

- 审计对象：当前 RN 构建 `dev.shudeng.mobile`，`main` `f20628d`，iPhone SE 3 / iOS 26.5 模拟器实机截图（2026-11-06）。
- 对照基准：[纸与灯视觉系统 v1](../../design/2026-10-27/visual-system/visual-system.md)（用户 2026-10-27 已确认）。
- 现状快照：[书架](evidence/current-shelf-375.png) · [笔记](evidence/current-notes-375.png) · [对话](evidence/current-conversations-375.png) · [我的](evidence/current-profile-375.png) · [阅读](evidence/current-reader-375.png)
- 对照图：[书架与我的](evidence/before-after-shelf-profile.png) · [阅读页](evidence/before-after-reader.png) · [字体对照](evidence/serif-fallback-compare.png)

## 结论

不是缺一个新的设计方向，而是三个具体断点让“已确认的设计”没有出现在屏幕上：

1. **宋体全部回退成系统无衬线。** `fontFamily: "Songti SC"` 在 RN/iOS 上不生效（`src/ui/chat/format.ts` 已记录“family 名会回退系统字体”）。书封字衣、书架书名、分组标题、“我的”品牌区因此全部变成 PingFang，只有 WebView 阅读正文的 CSS 宋体仍然正常。这是“没有书卷气”的第一原因。
2. **根页面页头被系统大标题 + 大搜索框替代。** 书架/笔记/对话三屏是同一套“31pt 大标题 + 灰色胶囊搜索 + 列表”，首屏约 150pt 被控件吃掉；v1 确认的编辑感页头（宋体 30 标题 + 36pt 圆形操作 + 按需展开的 38pt 搜索）没有落地。
3. **品牌与细节层没有兑现。** “我的”没有页面标题和品牌区，一进来就是设置；书封没有 `e1` 阴影；`已读 0%` 使用暖灯色形成噪音；“笔记”tab 图标没有填充态；对话摘要出现 `##` Markdown 残留。这些是“原型”和“产品”的差别。

把三个断点补上，界面就会先回到“像产品”；再叠加 P1/P2 才是“眼前一亮”。

## 与已确认基准的差距

| 项目 | 纸与灯 v1（已确认） | 当前实现 | 影响 |
| --- | --- | --- | --- |
| 页面标题 | 宋体 30，自定义页头，左对齐 | 系统大标题，iOS 26 下渲染为无衬线 | 气质从“书房”变“系统工具” |
| 搜索 | 38pt `paperDeep` 胶囊，按需展开 | 常驻大胶囊搜索框，占约 52pt | 首屏被控件占满，三屏同质 |
| 书封 | 真实封面优先；字衣书衣；`e1` 阴影 | 字衣已有，但无阴影、平涂色 | 书墙不成立，像占位图 |
| 继续阅读 | 首屏固定主角：封面 64×90 + 进度 + 接着读 | 有进度才出现，样式弱、信息散 | 没有“上次读到哪”的连续性 |
| “我的” | 标题 + 灯标/字标/口号 + 设置组 | 无标题、无品牌，直接是设置列表 | 品牌记忆点缺失 |
| 阅读页 | 章节眉标（灯色小字）+ 宋体章名 + 18.5/32 正文 + 28 边距 | 章名与正文层级弱，页头为无衬线 | 阅读页是产品灵魂，完成度不足 |
| 底栏 | 56pt，选中 = 填充图标 + 墨色 | 尺寸正确，但“笔记”无填充态 | 细节不一致 |
| 空状态/文案 | 灯标 + 宋体标题 + 单一主操作 | 有组件，但字体回退、无视觉锚点 | 首次使用不像成品 |

代码落点（供实现时定位）：

- 字体回退：`apps/mobile/src/ui/theme.ts:99`、`components/BookCover.tsx:77`、`components/SectionHeader.tsx:132`、`ShelfScreen.tsx:443`、`components/EmptyState.tsx:82`、`reader/NoteSheet.tsx:610`、`settings/SettingsParts.tsx:280`、`(profile)/about.tsx:191`。
- 页头与搜索：`src/ui/navigation/nativeListNavigationOptions.ts`、`src/ui/navigation/useNativeListSearch.ts`、`ShelfScreen.tsx` 的 `Stack.Screen` / `Stack.Toolbar`。
- 品牌区：`app/(tabs)/(profile)/profile.tsx`（`headerShown: false`，页面以“设置”开头）。
- 底栏：`src/ui/BottomBar.tsx:30`（`square.and.pencil` 无 fill 变体）。
- 进度噪音：`ShelfScreen.tsx:223`（`0%` 也走 `lampInk`）。

## 设计语言备忘（一句话版）

**纸是底，灯是强调，书是主角。** 其余元素全部后退：系统无衬线只用于工具文字；暖灯色只给 AI、进度、选中和引文编号；宋体只给书名、原文、引文；封面是书架唯一的“图”。

## 建议与顺序

### P0 · 半天，低风险（先回到“像产品”）

1. 修字体令牌：`font.serif` 改为 `SongtiSC-Regular`，新增 `serifBold = "SongtiSC-Bold"`，替换上表所有 `"Songti SC"` 用法；验收标准是书封、书名、分组标题截图与基准一致（对照 `evidence/serif-fallback-compare.png`）。
2. 书架恢复 v1 页头：宋体 30“书架”+ 右侧 36pt 搜索/导入圆钮；搜索按需展开为 38pt `paperDeep` 输入；继续阅读卡固定首屏；第一排完整书封可见。
3. “我的”加回品牌区：56pt 灯标 + 宋体 22“书灯”+ 口号 + 三组设置行 + 版本脚注。
4. 书封补 `e1` 阴影；`0%` 显示“未开始”（`ink3`），仅 >0 用暖灯色；补“笔记”tab 的 fill 图标。
5. 对话摘要去掉 Markdown 标记；测试/开发文案（如“本机验收 · local-mock”）只在开发构建出现。

### P1 · 1–2 天（让书架有“一张桌面”）

- 继续阅读卡升级为 hero：封面 82×116、暖灯晕、章节与进度、墨色“接着读”按钮；最近在读横向书架；“我的书籍”按正在读/未开始分组。
- 三个空状态（书架/笔记/对话）统一为灯标 + 宋体标题 + 单一主操作。
- 启动屏与应用图标与 A 方案一致，首次导入有引导。

### P2 · 2–3 天（阅读与问答的完成度）

- 阅读页：章节眉标（灯色、字距 0.18em）、宋体章名 24、正文 18.5/32、左右 28；覆盖式控件 200ms 淡入（ADR-0013 不变）。
- 问答面板：依据卡、宋体引文、上标引用、输入区；生成中灯点 1.8s 呼吸；面板 240–260ms 进入。
- 动效与触感：tab 切换、选文、保存成功 haptic；Reduce Motion 下静态化；深色模式两尺寸实测。

## 边界

- 不改阅读内核、检索、AI 协议、数据与保存模型；不新增第三方依赖；不伪造真实封面（保留字衣回退）。
- 笔记/对话/我的继续使用系统列表（ADR-0014 / ADR-0016），只在内容层补品牌，不退回手写列表。

## 验收

1. 375×667 与 390×844，浅色与深色逐页截图；与 `2026-10-27/visual-system/evidence` 逐项对照。
2. 字体：书封、书名、分组标题、章名确认渲染为宋体（截图对照，不靠代码推断）。
3. Dynamic Type XXXL、VoiceOver、Reduce Motion 各验一轮；首屏内容位置记录。
4. `pnpm -r typecheck`、`pnpm test` 通过；视觉结论另存同尺寸截图。

## 待确认

1. 是否按 P0 开工（字体 + 书架页头 + 我的品牌区 + 细节）。
2. 书架页头用自定义页头替代系统大标题，笔记/对话保持系统列表——是否接受？
3. 继续阅读卡是否恢复为书架首屏固定主角（即使当天只有一本在读）？
