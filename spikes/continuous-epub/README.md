# 连续 EPUB 引擎隔离验证（一次性）

在仓库根目录执行：

```sh
node spikes/continuous-epub/serve.mjs
```

打开 <http://127.0.0.1:5189/>，点击“第一章与第二章接缝”。只验证完整上游引擎能否让两章同时可见、在同一容器中跨章滚动；不接书灯数据库、用户 EPUB、存储、原生通道或产品 adapter。页面为技术验证，不是产品视觉方案。

旧引擎对照为 <http://127.0.0.1:5189/?engine=current>，加载本任务冻结的本地 1.0.1 + 项目 patch 副本 `.build/continuous-epub-20261109/upstream/current-foliate-js-1.0.1-projectpatch`。副本来自升级前的 pnpm 实体包，正式依赖升级后旧对照仍固定；旧 patch 只供技术对照，生产依赖已不再应用它。两者默认使用同一三章 book 和 375×600 视口、18px 字号、335px 文字宽度上限、0px gap；旧版设 `margin=20px`，新版设 `margin-top/right/bottom/left=20px`。状态给出实际视口与文档几何尺寸，仍需核对真实布局。旧版接缝按钮只定位当前章末尾，不替它自动下一章，预期不能显示相邻两章。

## 固定依赖

完整 [readest/foliate-js](https://github.com/readest/foliate-js/tree/b34a0aa63163d19cd13e2ecd19b678394c32fee5) 提交 `b34a0aa63163d19cd13e2ecd19b678394c32fee5`，MIT。原型通过 Vite alias 使用同一提交的 `view.js`、`paginator.js`、CFI、overlayer、section-chunks 及其依赖，没有改写引擎。

原型源码暂存于 `.build/continuous-epub-20261109/upstream/foliate-js-b34a0aa63163d19cd13e2ecd19b678394c32fee5/`，复用 `packages/reader-web` 的 Vite。该 alias 仅用于独立实验；产品已另行在 package.json/lockfile 固定同一 fork、生成移动端资源并部署 Small Release，详见[本轮验收](../../docs/validation/2026-11-09/continuous-epub.md)。

无需长期保留展开源码。需要复现时，在仓库根目录按以下步骤重建；服务会解析两套引擎的 import，因此新旧源码都须准备，即使只打开新版 URL。

1. 下载固定 fork 并输出校验值：

```sh
mkdir -p .build/continuous-epub-20261109/upstream
curl -fL https://codeload.github.com/readest/foliate-js/tar.gz/b34a0aa63163d19cd13e2ecd19b678394c32fee5 -o .build/continuous-epub-20261109/upstream/foliate-js-b34a0aa.tar.gz
shasum -a 256 .build/continuous-epub-20261109/upstream/foliate-js-b34a0aa.tar.gz
```

SHA256 必须为 `107ad7b2937ea39d071c7c6b85bd94c4f169b1987883d6acf8aebd832ed1134f`。

2. 校验通过后展开 fork：

```sh
tar -xzf .build/continuous-epub-20261109/upstream/foliate-js-b34a0aa.tar.gz -C .build/continuous-epub-20261109/upstream
```

3. 下载旧版技术对照并输出校验值：

```sh
curl -fL https://registry.npmjs.org/foliate-js/-/foliate-js-1.0.1.tgz -o .build/continuous-epub-20261109/upstream/foliate-js-1.0.1.tgz
shasum -a 512 .build/continuous-epub-20261109/upstream/foliate-js-1.0.1.tgz
shasum -a 256 patches/foliate-js@1.0.1.patch
```

旧版 tar 的 SHA512 必须为 `0a3e21dae6f969503ec9481b86f5610b2c708b418f178a723416ba2f0f7ee96298d51781c62a48b67da41013babbb56eff16178caef5d51ef8fadfb25bfd2ee7`，来自升级前 lockfile 的 integrity。patch 的 SHA256 必须为 `dc3ded0270442a9696c5193598c2b612e1e29babe7c674b8ce56799759ed7164`。

4. 校验通过后，在空的旧版目录展开并应用一次 patch：

```sh
mkdir -p .build/continuous-epub-20261109/upstream/current-foliate-js-1.0.1-projectpatch
tar -xzf .build/continuous-epub-20261109/upstream/foliate-js-1.0.1.tgz -C .build/continuous-epub-20261109/upstream/current-foliate-js-1.0.1-projectpatch --strip-components=1
git apply --directory=.build/continuous-epub-20261109/upstream/current-foliate-js-1.0.1-projectpatch patches/foliate-js@1.0.1.patch
```

许可保留在两套源码各自的 `LICENSE`。随后运行本页开头的启动命令；本轮已有冻结副本时无需重复重建。以上重建步骤按固定来源与历史校验值整理，本轮未重新下载演练。

## 观察入口

1. 点击接缝按钮：前章“【第 N 章末尾】”与后章标题应同屏。右侧 `liveDocuments` 应大于 1，`visibleIndices` 应含相邻两章。
2. 在正文滚动与回滚：观察接缝和 `currentCFI`。页面状态读取真实 iframe 几何位置，没有模拟连续效果。
3. 点击“高亮接缝原文”：标注走上游 `getCFI`、`addAnnotation` 和 Overlayer；用“调整字号”“切换分页”继续观察。
4. 浏览器控制台入口为 `window.__continuousSpike`，提供 `snapshot()`、`await seam(0)`、`await seam(1)`、`await highlight()`、`container()` 与原始 `view/book`。

最短复现：

```js
// 先打开对应 URL，等 snapshot().ready === true。
await window.__continuousSpike.seam(0)
window.__continuousSpike.snapshot()
// 新引擎：liveDocuments=3，visibleIndices=[0,1]。
// 旧引擎：liveDocuments=1，visibleIndices=[0]。
// 再把指针置于正文，用一次向下 wheel deltaY=500 的动作。
// 新引擎 section.current 变为 1，仍沿同一容器向前滚。
```

操作的等待终点为 `operation === "idle"`，同时 `lastOperation === "定位第 1 / 2 章接缝完成"`。`load/scroll/relocate` 只刷新显示，不改写最后一个已完成操作；首屏初始化在准备稳定后才设置 `ready=true`，避免刚点击接缝时又被初始化覆盖。

## 本次已观察结果（浏览器限定）

2026-11-09，由同一主任务统一操作浏览器并检查截图，结果回传给本原型维护者：

| 同一三章输入与接缝动作 | 观察结果 |
| --- | --- |
| 本地旧引擎 `?engine=current` | 1 个 document，`visibleIndices=[0]`，无法两章同屏。 |
| 固定 Readest fork | 3 个 document，`visibleIndices=[0,1]`，前章末尾与后章开头同屏；截图已人工检查。 |
| 固定 fork，接缝处一次 wheel 500 | 沿同一容器跨入 `section.current=1`。 |

这证明了最小书对象上的浏览器红绿反馈。后续产品已接入固定 fork 并部署 Small Release，双向连续跨章、旧高亮回跳后继续滑动已通过；这些产品结果来自[本轮验收](../../docs/validation/2026-11-09/continuous-epub.md)，不能归因于本原型，也不表示其余设备回归或内存验收完成。

本原型默认构造三章 `book` 对象，可用 `?chapters=40` 扩展为 40 章，复用上游公开 book 合同；不覆盖 EPUB ZIP/原生按资源加载、旧 CFI/存储兼容、长章 chunk、iOS 惯性触控或原生 curl。巨型 spine 的 chunk 章节标题限制由产品 adapter 另行处理：保存书名作为后备，CFI 仍准确，原型不证明精确 TOC 标题。

## 多章取样与关闭

打开 <http://127.0.0.1:5189/?chapters=40>，复用同一技术章节生成 40 章（有效范围 3–100，默认 3）；不会读取用户文件。`snapshot()` 显示 `chapterCount/liveDocuments/activeBlobURLs/loads`；`await seam(20)` 定位第 21/22 章接缝。持续前向滚动与回滚时在各位置取样，预载循环的 8 个 View 不是全局内存上限。

```js
window.__continuousSpike.snapshot()
await window.__continuousSpike.seam(20)
window.__continuousSpike.close()
// 关闭后应 closed=true, liveDocuments=0, activeBlobURLs=0。
```

`close()` 只关闭本原型 reader 并释放本原型创建的 Blob URL，不删除文件。后续操作需重载页面。此观测只统计 iframe/Blob URL 数，不测 App/WK RSS，也不证明原生 session/lease 回收。

本轮主任务回传的 40 章实际取样：连续 15 次 `wheel deltaY=900` 后，live document 从 5 增至 16，已读文档未回收；`goTo` 后裁剪至约 3 章；`close()` 后 live document 与 Blob URL 计数均为 0。因此不能把预载循环常数当作全局 8 章上限。

## 停止与清理

停止服务按 Ctrl+C。确认服务已停止且主任务不再取样后，可清理本任务的 `.build/continuous-epub-20261109/upstream`（约 13 MiB 新引擎展开源码、3.6 MiB 下载包和 460 KiB 旧对照）；保留本目录的原型源码、本 README 及旧技术对照 patch 即可按上述固定来源重建。本轮文档整理未删除暂存源码，也未停止主任务服务。
