# EPUB 文件资源端口

2026-11-03，ADR-0019 的 RN iOS 迁移。本文记录平台资源读取合同；发布能力仍以 iOS 验收为准。

## 选择与依赖

使用独立 ReadiumZIPFoundation 3.0.1，固定 Git commit `adb49c8bfe060cc187370b12fa081012a6440b86`，MIT。没有引入旧 App、Readium publication/导航或 Swift 业务模型。CocoaPods source 由 `apps/mobile/plugins/withEpubResources.cjs` 注入，Expo prebuild 可以重建，podspec 声明精确 3.0.1，许可证作为模块资源随包分发。生产不引用本机 DerivedData。

比较过 foliate 的 zip.js vendor：foliate 1.0.1 只声明开发依赖 `@zip.js/zip.js ^2.7.52`，bundle 不能核实精确版本；Hermes Streams 也未实测完整。因此 iOS 先用成熟原生 ZIP 库，保持 core 资源接口可替换。

## 数据路径与所有权

`packages/core/src/rag/epub-resources.ts` 定义 EpubResourceArchive。core 处理 XML、manifest、spine、文本与索引；平台仅提供文件、解压和二进制资源。共享 XML/path/text 规则在 `epub-xml.ts`，同步兼容提取和新逐章读取共用它。

`apps/mobile/src/platform/epubArchive.ts` 提供：

1. `openEpubArchive(uri,{signal?})` 返回 entries/getSize/readText/materialize/close 与 reader descriptor。每个 import/index/cover consumer 独占 session。
2. `readText(path)` 只返回当前资源字符串，不读整档，不做 chunk base64。UTF8 与 UTF16 XML 受支持。普通布尔 CancellationSignal 在 native 请求期间按 25 ms 检查；取消关闭并 join 独占 session。
3. `materialize(path)` 返回 `{uri,bytes,release()}`。封面复制或处理必须在 finally 中 release，失败不能保留 lease。
4. Reader 使用 `openReaderEpubArchive` / `closeReaderEpubArchive`。descriptor 只含 sessionID、resourceBaseURL、路径到 opaque resourceID 的元数据，不含本地文件 URI 或压缩包 bytes。
5. close 撤销访问、取消并等待解压任务、关闭源描述符、删除临时资源。App 本进程首次打开时只清理专用 cache 中符合 session UUID 命名的旧目录，保留未知项和书籍原档。

源文件限定 App Documents/Books（含同目录的导入暂存文件），解析真实路径后校验。源文件的单一打开描述符固定本次读取对象；ZIP 随机读取串行处理，不因并发 seek 串章。拒绝 ZIP 穿越、重复路径和 symlink。ZIP 路径从不用于生成磁盘输出路径。

## WK 合同

WK 创建前注册 `EpubResourceScheme(archives: EpubResourceStore.shared.archives)`，scheme 为 `shudeng-epub`。`setReaderHTML` 只接 App 自有 bundle，`activate(sessionID)` 只允许本 view 当前 session。读取页面 `pageURL` 后，同源资源请求由 native store 再次核实 session/resource UUID；CORS 仅允许 `shudeng-epub://reader`。

原生先把资源解压到 lease 并完成字节/CRC 校验，再以 64 KiB 块发送 WK。Foliate 使用 `new EPUB(loader).init()` 后 `view.open(book)`；直接给 view URL 仍会走整档 fetch→Blob→File，不符合本合同。相对 CSS/image 由 Foliate 改写为 Blob URL。WK stop 取消对应任务。真正卸载时先停止 WK，再关闭 Foliate loader，最后 await scheme.close；临时遮盖不销毁 session。scheme 的并发 close 等待同一清理任务；close 是该 handler 的终结状态，后续 activate 不会复活它，重新打开使用新 handler。

连续引擎 adapter 将 descriptor 的 ZIP 路径与大小映射为 `entries[{filename,uncompressedSize}]`，供引擎判断章节与分块；该步骤只读取元数据，不读取整书正文，也不把 opaque resourceID 当路径。多个章节文档可同时存活，定位、选文与书签必须按当前可见文档或实际目标文档处理，不能假定 `getContents()[0]` 就是当前章。

固定 fork 用 `about:srcdoc` 加载章节。App 自有 shell 的 CSP 因而允许同源与 blob frame，native 子 frame 导航白名单精确增加 `about:srcdoc`；章节先经 `securePublication` 净化并注入禁脚本、禁嵌套 frame 的正文 CSP，消息处理仍只接受 main frame。该兼容不放宽任意远程导航或书籍脚本执行。实际 iOS 接线结果见[连续阅读验收](../validation/2026-11-09/continuous-epub.md)。

## 运行保护与边界

策略集中在 EpubResourceStore：每个独占 session 最多 20,000 条目、8 MiB 实际 metadata 读取、同时存活 native 临时资源 128 MiB；单资源实际解压 64 MiB、解压 30 秒。校验实际输出与 CRC，不只相信 ZIP 头。已处理且 release 的章节不累计计费；压缩包没有 100 MiB 整档限制。reader/import/index 可以并行拥有不同 session，128 MiB 不是跨 session 的全局上限。

这些是保护参数，**不是已验收的设备支持范围**。单章字符串/XML 和 WK Blob 仍驻留内存；native live quota 不等于 App/WK RSS 上限。巨单章、巨封面的像素解码、真实大书的首屏/峰值/取消耗时仍需 iOS 量化，不能把删除旧数字或 macOS 测试通过称为大书能力完成。

## 验证

正式小型测试包位于 `apps/mobile/modules/shudeng-epub/Package.swift`，直接编译产品资源 Swift 源，不包含 Expo/presentation。运行 `scripts/test-epub-resources.sh`；可以通过 SHUDENG_ZIP_SOURCE 指定干净、HEAD 为锁定 commit 的离线 clone，runner 会核对，默认使用正式 Git commit 依赖。构建与临时文件固定在 `.build/epub-resources`，测试临时目录退出回收。

已通过：

1. 12 个产品 Swift 测试：11 个真实 ZIP 测试覆盖 101 MiB archive 仅读 11 字节资源、18 MiB 单章重复读取累计 144 MiB、伪造中央目录大小后的实际解压预算、CRC、取消/close、metadata 预算、重复/穿越/symlink 与进程残留清理；另 1 个 scheme 测试覆盖并发 close 等待清理及关闭后不能重新激活。
2. 旧 core EPUB fixture 6 测试与 shared helper 3 测试：归一化文本保持、12,000 层嵌套不递归、ENTITY 拒绝；平台 adapter 4 测试与 commit 插件 2 测试。
3. core/mobile 完整 TypeScript 检查通过。小测试包不能替代 Expo API 注册与 CocoaPods/iOS 编译。
4. 独立 macOS WK + 真实 foliate：17 sections，前两章的封面图和相对 CSS 成功；24 MiB 活动资源首块后 abort 触发 native WK stop=1，后续读取恢复，关闭无临时资源。可通过 tests/WKProbe/build-probe.mjs 构建使用产品 loader 的 probe，再运行小测试包产出的 EpubWKProbe。
5. 最终 12 测试连续两轮通过（0.367 / 0.361 秒），构建目录 189,556 → 189,564 KiB，只有 8 KiB 测试元数据变化，无 tmp-*；模拟 Swift 失败退出码 73，trap 仍完成临时目录回收。

上述资源专题最初未覆盖统一 Pod 的 iOS 编译及 Hermes→Expo API→WK 端到端；后续 Small Release 的实际逐资源阅读接线见[连续阅读验收](../validation/2026-11-09/continuous-epub.md)，不能将这里的旧未测状态当作当前状态。真实大 EPUB 的 App/WK 峰值与首屏、杀进程恢复及删除过程中读取仍需对应证据；本文不重复总体验收状态。
