# #13 旧问答检索 scope-first 加固交付

状态：`FIXED`。主控已在 iPhone 17 模拟器完成修正后定向测试，3/3 PASS、0 failure、0 error。提交仅限 `SemanticRetrieval.swift`、`SemanticTests.swift` 和本交付记录；不 push、不合并、不关票。

## 版本与文件

- Base HEAD：`c21e98a4833d405c0732e37b95700363f3148cbb`
- Final commit：提交后记录于主控交付回执。
- Commit status：当前会话的 `.git` 为只读，`git add` 无法创建 `index.lock`；提交由主控按下方限定文件执行。
- 工作区源码 SHA256：
  - `ios/Shudeng/Sources/SemanticRetrieval.swift`：`ab4fd95b5e4b6bcc7d54a5ce3bf3811f23d34216a06d786e8a7c475da90cdb1c`
  - `ios/ShudengTests/SemanticTests.swift`：`c142c4973e222b70d3364aeb2b8e3bf88bc9c14911930576b4bf08f540cdeff7`
- 本票 diff SHA256：`7c13128c01a4d018ffa9483970562134c720365fc1bda8c9272c91fb5627e483`
- 类型检查产物 `/private/tmp/shudeng-issue13-typecheck/Shudeng.swiftmodule` SHA256：`a4c3409f86542cf6c111b7ac877259b5c9a122736da6c5d144e67bf71ba26be8`
- 用户原有 `README.md` 修改保持未暂存。

## 改动

- `sentenceUnits(scope:)` 先调用 `scopedFragments(scope:)`，随后仅用允许样本判断语言。
- `chapterCandidates(scope:)` 的 fragment rows 与 embedding 扫描均先应用 `scope.sql`。
- `chapterWindows(scope:)` 的 fragment rows 与 embedding 扫描均先应用 `scope.sql`。
- `permits(_:scope:)` 只读取当前书、当前范围 fragment，再核 evidence。
- 新增最小 `IndexDatabase.scopedFragments(scope:)` 复用；未修改 `retrieve`、`languageSample`、无 scope 搜索或索引准备。
- 新增测试 `testIssue13ScopeFilterPrecedesLanguageAndCandidates`、`testIssue13PermitsUsesScopedFragmentRows`：未读英文 sentinel 的 id/行序早于允许中文 rows；检查语言样本、sentence units、两类候选及全书/局部排名边界，检查未读 evidence 先/后出现均拒绝。

## 主控首轮结果与 fixture 修正

- xcresult：`/private/tmp/shudeng-issue13-scope-first.xcresult`。
- iPhone 17：`A1CD94D7-2F21-48F5-8EE1-6A558ADA77C9`，iOS 26.5（23F77）。
- `QuestionTests/testIssue13ReadPersistenceFailureRetryAndDisjointBooks`：PASS，7.323 秒。
- `SemanticTests/testIssue13ScopeFilterPrecedesLanguageAndCandidates`：FAIL，0.019 秒。
- `SemanticTests/testIssue13PermitsUsesScopedFragmentRows`：FAIL，0.252 秒。
- 两项均停在被测产品断言之前：`SemanticTests.swift:107`，`caught error: "storage"`。

确认根因：

- `embeddings` schema 为 `book_id, model, fragment_id, piece, offset, original, vector`；六个文本绑定加第 7 个 BLOB 绑定及列顺序正确。
- `initialize`、两章 `commit` 和 fragment rows 已成功，失败发生在 `sqlite3_step` 写入 embedding。
- schema 的 `CHECK(length(vector)=1536)` 检查 BLOB **字节数**；原 fixture 使用 1536 个 `Float`，实际绑定 6144 字节，触发 CHECK 失败并映射为 `IndexError.storage`。
- `SemanticEmbedding.dimension` 为 384；384 个 `Float32` 才是 schema 要求的 1536 字节。

修正：测试夹具改为按 `SemanticEmbedding.dimension` 生成向量，并显式列出 embeddings INSERT 列名，避免维度字面量或隐式列序误用。产品检索代码无需修正。

## 修正后定向结果

- xcresult：`/private/tmp/shudeng-issue13-scope-first-r2.xcresult`。
- 设备：iPhone 17，`A1CD94D7-2F21-48F5-8EE1-6A558ADA77C9`，iOS 26.5（23F77）。
- `QuestionTests/testIssue13ReadPersistenceFailureRetryAndDisjointBooks`：PASS，7.765 秒。
- `SemanticTests/testIssue13PermitsUsesScopedFragmentRows`：PASS，0.034 秒。
- `SemanticTests/testIssue13ScopeFilterPrecedesLanguageAndCandidates`：PASS，0.080 秒。
- xcresult metrics：3 tests、0 failed、0 skipped、0 error；总计 `TEST SUCCEEDED`。

测试清理阶段出现 `vnode unlinked while in use` 警告，但 xcresult 未记录测试失败或 error。fixture 在测试结束时先删除临时根目录，随后才释放仍打开的 `IndexDatabase` SQLite handle，与告警时序一致；属于临时 DB handle 未先关闭的测试卫生问题，不影响断言或产品路径，本次仅记录，不扩大改动。

## 验证

源码类型检查（PASS，无 error；输出仅现有 warning）：

```sh
CLANG_MODULE_CACHE_PATH=/private/tmp/shudeng-issue13-module-cache SWIFT_MODULECACHE_PATH=/private/tmp/shudeng-issue13-module-cache xcrun swiftc -typecheck -module-name Shudeng -sdk /Applications/Xcode.app/Contents/Developer/Platforms/iPhoneSimulator.platform/Developer/SDKs/iPhoneSimulator27.0.sdk -target arm64-apple-ios16.0-simulator -swift-version 5 -enable-testing -DDEBUG -module-cache-path /private/tmp/shudeng-issue13-module-cache -I /private/tmp/shudeng-issue17-derived/Build/Products/Debug-iphonesimulator -F /private/tmp/shudeng-issue17-derived/Build/Products/Debug-iphonesimulator/PackageFrameworks -F /private/tmp/shudeng-issue17-derived/Build/Products/Debug-iphonesimulator -Xcc -fmodule-map-file=/private/tmp/shudeng-issue17-derived/Build/Intermediates.noindex/GeneratedModuleMaps-iphonesimulator/Minizip.modulemap -Xcc -fmodule-map-file=/private/tmp/shudeng-issue17-derived/Build/Intermediates.noindex/GeneratedModuleMaps-iphonesimulator/OnnxRuntimeBindings.modulemap ios/Shudeng/Sources/*.swift
```

`SemanticTests.swift` 与 `QuestionTests.swift` 类型检查（PASS，无 error）使用同一 SDK/依赖路径，并在 `-I` 中优先加入 `/private/tmp/shudeng-issue13-typecheck` 和现有测试模块路径；命令参数与上述命令一致，仅模块名、源文件及 XCTest frameworks 路径不同。

测试编译原始失败及修复：

1. `languageSample`、`permits` 是 actor 方法；首版测试漏 `await`，或在 XCTest autoclosure 内使用 `await`。修复为方法外先 `await`，再断言。
2. `IndexDatabase` 没有 `url` 属性。修复为从 fixture root 重建 `BookIndex` URL。

fixture BLOB 修正后的 `SemanticTests.swift` 与 `QuestionTests.swift` 类型检查再次 PASS，无 error；仅有既有 `SemanticTests.swift:331` `try` 冗余 warning。

本会话的实际 simulator 尝试失败：

```sh
xcrun simctl list devices available
```

原始失败关键行：

```text
CoreSimulatorService connection became invalid.
Error opening log file (/Users/wangxinxin/Library/Logs/CoreSimulator/CoreSimulator.com.apple.CoreSimulator.simctl.log): Operation not permitted
Unable to locate device set: ... Connection refused
```

本会话的 `xcodebuild build-for-testing` 同样被拒绝：

```text
xcodebuild: error: Could not resolve package dependencies:
  sandbox-exec: sandbox_apply: Operation not permitted
```

未创建或沿用任何冒充本次通过的 xcresult。主控首轮未调用真实 AI，未触碰原始业务数据；本会话未读取 Keychain、未监听 HTTP、未调用 AI。

## 未验证

本票定向范围无未验证项。以下沿用原票边界，不属于本次范围：

- #11 最终检索接入及其独立质量结论。
- 真机、真实 AI 服务、HTTP、Keychain 和相关产品验收。
