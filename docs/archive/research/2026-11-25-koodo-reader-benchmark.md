# Koodo Reader 对照研究

2026-11-25。优先验证**目录跳转后能一键回到原段**和**阅读设置先展示常用项**。两项都可以沿用书灯现有原文定位、组件和引擎。Koodo 的跨端价值在于让阅读引擎成为独立模块，平台侧各自承接系统能力。书灯已采用相近的拆分。 [书灯架构](../../architecture.md) · [RN 路线](../../adr/0019-react-native-langchain-architecture.md) · [连续 EPUB 决定](../../adr/0022-continuous-epub-engine.md)

## 证据范围

| 范围 | 核对结果 |
| --- | --- |
| iOS | 中国区和美国区 App Store 均显示 2.4.6。商店更新说明明确写了 RN 新架构、目录跳转后的「返回原处」按钮、系统词典和翻译，以及段落模式和阅读尺。 [中国区](https://apps.apple.com/cn/app/koodo-reader/id6744887779) · [美国区](https://apps.apple.com/us/app/koodo-reader/id6744887779) |
| Android、桌面、网页 | GitHub 最新稳定版为 v2.4.7，发行附件含 Android APK 与 macOS、Windows、Linux 包。公告的「移动版」条目包括阅读设置分基础与高级，以及高级项分组。网页有独立入口。 [v2.4.7 发布](https://github.com/koodo-reader/koodo-reader/releases/tag/v2.4.7) · [网页版](https://web.koodoreader.com) |
| 源码 | 主仓核对 v2.4.7 对应提交 `0753495`，能看到 React/Vite 网页与 Electron 桌面代码。独立 Kookit 核对 `9edf96b`，可见 RN Expo 的引擎构建出口。未找到可和 App Store 2.4.6 对应的完整移动宿主源码或精确 Kookit 构建版本。 [主仓版本](https://github.com/koodo-reader/koodo-reader/tree/075349561f0a4ba948072fd28283fb0df014dd34) · [Kookit 版本](https://github.com/koodo-reader/kookit/tree/9edf96b32e3d5b3e1bb5ac39a98586ea7268f56e) |

本次使用项目官网、发行记录、App Store 信息与上述源码，未安装或实测 Koodo。滚动手感、排版效果、精确返回的边界和内存占用仍待同机实测。

## 设计可以怎么借鉴

1. **先做「返回阅读位置」的独立示例。** 阅读到第 3 章中段，经目录跳到第 10 章，完成跳转后出现「返回原处」。点一次回到之前那段原文。跳转前可从书灯现有定位接口取得原文位置，确认到达后才展示返回入口，切书或关闭阅读会话时清除。目录返回属于阅读器，引用后的「返回问答」已有独立流程。验收覆盖重复段落、字号或阅读模式改变后的定位、快速连点和切书，避免历史位置串到另一本书。 [Koodo iOS 更新说明](https://apps.apple.com/cn/app/koodo-reader/id6744887779) · [书灯目录接线](../../../apps/mobile/src/reader/useEpubNavigation.ts#L342-L383) · [原文定位入口](../../../apps/mobile/src/reader/useReaderState.ts#L443) · [引用返回](../../../apps/mobile/src/ui/reader-question/ReaderQuestionProvider.tsx#L187-L215)
2. **沿用「常用先显示，进阶按需展开」。** 书灯已经把字号、字距、行距、阅读方式和主题集中在书内设置，符合这个思路。后续如果新增页边距和段距，可把这些选项放在同一阅读设置里按需展开。首层仍操作当前正文，保留按书保存和即时预览。在同一部 iPhone 上用书灯、Koodo 和 Apple Books 打开同一份中文 EPUB 的同一段，先比较默认排版，再尽量对齐字号，检查段间留白、标题层次，以及调整时的原文位置。高级分组来自 Koodo v2.4.7 的移动版公告，iOS 2.4.6 的分组表现未实测。 [Koodo v2.4.7 更新说明](https://github.com/koodo-reader/koodo-reader/releases/tag/v2.4.7) · [书灯阅读规范](../../product-scope.md#书架与阅读) · [书灯 v0.5.5](../../releases/v0.5.5.md)
3. **让阅读原文和辅助入口在同一上下文。** Koodo 把系统词典、翻译和阅读辅助放在读书场景。书灯可以继续打磨已有「选文 → 解释 → 点击依据回到原文」短路径，把选中原文和出处的关系显示清楚。 [Koodo iOS 更新说明](https://apps.apple.com/cn/app/koodo-reader/id6744887779) · [书灯问答规范](../../product-scope.md#阅读问答与对话)

## 架构里的可复用思路

| 观察 | 对书灯的意义 |
| --- | --- |
| **共享阅读核心，宿主接系统。** Kookit 的 BookHelper 根据格式选渲染器，公开桌面 Viewer 将结果交给同一渲染接口；Rollup 分别产出桌面 ES 模块、移动内联 UMD，以及从 `src/mobile.ts` 导出的样式 helper。Kookit 的 EPUB 链路单独走 EpubRender 与 ZIP loader。 [格式分派](https://github.com/koodo-reader/kookit/blob/9edf96b32e3d5b3e1bb5ac39a98586ea7268f56e/src/helpers/bookHelper.ts#L74-L105) · [宿主调用](https://github.com/koodo-reader/koodo-reader/blob/075349561f0a4ba948072fd28283fb0df014dd34/src/containers/viewer/component.tsx#L552-L568) · [构建区分](https://github.com/koodo-reader/kookit/blob/9edf96b32e3d5b3e1bb5ac39a98586ea7268f56e/rollup.config.js#L79-L117) · [样式 helper 构建](https://github.com/koodo-reader/kookit/blob/9edf96b32e3d5b3e1bb5ac39a98586ea7268f56e/rollup.config.js#L157-L164) · [EPUB 渲染](https://github.com/koodo-reader/kookit/blob/9edf96b32e3d5b3e1bb5ac39a98586ea7268f56e/src/renders/EpubRender.ts#L1-L35) | 书灯沿用 Foliate 渲染 EPUB、Readium 提供缺省 CJK 样式、iOS PDFKit 处理 PDF。将跳转、返回和原文定位保持在宿主与渲染器的接缝。以后扩平台时复用当前书、原文位置和读取接口，设备侧分别实现本机文件、选区和手势。 [书灯模块边界](../../architecture.md#模块职责与依赖方向) · [阅读器资源合同](../../architecture/epub-resources.md) |
| **本机数据与同步服务分开。** 公开桌面／网页调用同一个 DatabaseService，内部按 Electron IPC 和 Web localforage 选择存储。同步入口按配置创建 SyncUtil，官网提供用户自选网盘、WebDAV、NAS 等。主仓还附带 `kookit-extra` 的浏览器和桌面 bundle，公开可见这个调用入口，本次未找到对应的独立公开源码或逐包许可。 [存储分支](https://github.com/koodo-reader/koodo-reader/blob/075349561f0a4ba948072fd28283fb0df014dd34/src/utils/storage/databaseService.ts#L16-L44) · [同步入口](https://github.com/koodo-reader/koodo-reader/blob/075349561f0a4ba948072fd28283fb0df014dd34/src/utils/storage/syncService.ts#L1-L27) · [官网](https://koodoreader.com/zh) | 后续评估同步时先定义书档、进度、标注的身份、冲突处理、删除和备份恢复，依然从一次只接一个同步服务做起。当前可保留为设计依据。 [本机数据所有权](../../architecture.md#数据所有权与保存) · [当前产品范围](../../product-scope.md#当前阶段范围之外) |
| **用上正在读的内容。** v2.4.7 公开客户端 Ask 优先发送选文，空选文取当前章。官方接口可见原文、问题、最近五条记录及模式字段，自定义配置有独立模型请求。服务端内部与移动实现未核实。 [选文与当前章](https://github.com/koodo-reader/koodo-reader/blob/075349561f0a4ba948072fd28283fb0df014dd34/src/components/popups/popupAssist/component.tsx#L316-L386) · [官方请求](https://github.com/koodo-reader/koodo-reader/blob/075349561f0a4ba948072fd28283fb0df014dd34/src/utils/request/reader.ts#L38-L54) | 书灯已有当前整本书范围、工具查书和可回跳引用，继续沿用。可以用一段选文验证首次解释能否快速给到上下文，再用跨章题验证查书和出处回跳。 [书灯阅读 Agent 契约](../../architecture/reading-agent.md) · [此前竞品检索研究](research-reading-app-embeddings.md) |

主仓 LICENSE 与独立 Kookit LICENSE 都是 GNU AGPL v3，Kookit 包声明为 AGPL-3.0-or-later。当前建议研究交互和模块边界，使用书灯自己的界面与实现。如果以后考虑嵌入 Kookit 或移植源码，需要另核对对应代码的来源、许可证与发行义务。 [主仓许可证](https://github.com/koodo-reader/koodo-reader/blob/075349561f0a4ba948072fd28283fb0df014dd34/LICENSE) · [Kookit 许可证](https://github.com/koodo-reader/kookit/blob/9edf96b32e3d5b3e1bb5ac39a98586ea7268f56e/LICENSE) · [Kookit 包声明](https://github.com/koodo-reader/kookit/blob/9edf96b32e3d5b3e1bb5ac39a98586ea7268f56e/package.json)
