# iOS 优先的 RN/Expo 迁移计划

状态：草案，等待 ADR `0019` 评审。Android 暂停，代码与证据保留，不继续安装/构建。

## 门槛

- spike 分支 `spike/57-rn-langchain` 已达到：iOS/Android 原生 Agent、SQLite/checkpoint、EPUB/PDF WebView、native ONNX embedding、V5 闭环、真实代理 provider smoke。
- 未完成：官方 provider endpoint、真实手指手势/大 PDF、引用 locator→CFI、iOS Release 商店签名。
- 进入正式迁移前由人评审 ADR；`main`/`ios/` 不动。

## 阶段 1：iOS 壳与数据底座

1. 把 `apps/mobile` 从 demo 壳变成书灯 iOS 壳：真实书架、导入、设置入口。
2. 用户数据迁移：只读旧 Swift 数据（library/notes/bookmarks/questions），输出版本化 Anchor + 迁移报告；不写回旧 App。
3. SQLite/Drizzle 数据层正式化：应用数据与 LangGraph checkpoint 同库；启动迁移、WAL、删除清理。
4. AI 设置：provider/model/baseURL/key；key 用 SecureStore，不再从 Documents 读明文。
5. 构建入口统一 `scripts/build-ios-rn.sh`，30 GiB 门槛、`.build` 复用、产物上限。

## 阶段 2：阅读

1. EPUB/PDF 文件导入、缓存、删除；沿用 WebView reader + foliate/js/pdf.js。
2. 阅读进度、选字、标注、书签、深色、字号；locator 统一 AnchorV3。
3. 迁移旧 EPUB Readium locator / PDF page+rect；抽样真实书验证回跳。
4. 大 PDF/真实手势/中断恢复验收。

## 阶段 3：Agent 与检索

1. 真实 DeepSeek/Anthropic provider（官方 endpoint + key）；reasoning 流、工具轮回传。
2. 端侧 embedding/RAG 从 spike 接正式书库；索引状态、重建、删除。
3. 思考过程 UI/引用核对/上下文压缩沿用现有 Swift 行为规格。
4. 引用点击 → ReaderWebView `initialLocation` 的真实 locator 映射。

## 阶段 4：验收与切换

1. 与 Swift v0.4.8 同书同问题集对照；包体/冷启动/内存/索引耗时。
2. 备份/回退：旧 v0.4.8 安装包保留一份；新 App 数据迁移可重试、失败可见。
3. TestFlight/商店签名；只有通过后才讨论删除 Swift 版。
4. Android/Web 恢复时复用同一 core；不复制业务逻辑。

## 已知风险

- Release 体积：iOS 设备构建约 93MB（未签名），仍高于 33MB；需在迁移前决定是否继续裁剪 ORT/RN。
- ORT New Arch 补丁需随 RN/ORT 升级复验。
- 真实 provider key/网络与移动端内存/索引耗时仍缺证据。
- 迁移期间双线维护；旧数据只能读副本，不做不可逆写入。
