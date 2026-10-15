# #2 EPUB 导入、分页与位置保存

## 本票决定

- 最低 iOS 16：Readium 3.11.0 支持 iOS 15，本应用选择 iOS 16，覆盖 iPhone 8 及更新设备并保留后续 SwiftUI NavigationStack 的系统基线；本票使用 UIKit，不借此引入后续功能。当前实测为 iPhone 17 / iOS 26.5 模拟器，iOS 16 与真机未验证。
- SHA-256(完整 EPUB 字节) 是书籍身份。改名但字节相同复用记录和进度；同名/同 identifier 但字节不同分别保存，不猜测内容版本关联。本票没有移除操作。
- `Library/Application Support/Shudeng/Books/<sha256>.epub` 保留导入文件；`library.json` 保存书籍元数据和 Readium Locator JSON。原子写成功之后才更新内存并显示成功；位置失败显示持续错误与“重试保存”，保留内存中最新位置。重启只承诺最后已提交位置。
- 导入先复制隔离文件，确认 EPUB、版式、全部 spine 文件存在/可读及 XHTML 结构，再移动文件并原子提交书架；提交失败移除本次新增文件。被中断的 staging/orphan 不进入书架，下次同文件导入可复用身份。元数据读取失败阻止进入书架，不静默清空已有记录。
- 真实定位保存 `href`、resource progression，并补充 Readium 首个可见元素位置；采用递增代次防止较早页面异步回调覆盖较新位置。正文加载、原文匹配和 UI 错误需另外通过运行证据核实。
- Readium 3.11.0 的源码与资源保存在 `Vendor/Readium`；全部网络依赖 exact 锁定并提交 Package.resolved。仅移除旧 OpenDyslexic 5 文件及注册语句、裁剪 Package 产品；本票未提前实现卷页、滚动、目录或 AI。
- 三个未实施栏目仅提供入口及空态；网格书架/搜索/排序属于后续票，本票书架以最小列表承载导入与继续阅读。

## 构建与测试

打开 `ios/Shudeng.xcodeproj`，scheme `Shudeng`。模拟器不要求 Apple ID；真机签名需在 Xcode 选择自己的 Team。

```sh
xcodebuild -project ios/Shudeng.xcodeproj -scheme Shudeng -destination 'platform=iOS Simulator,id=A1CD94D7-2F21-48F5-8EE1-6A558ADA77C9' -derivedDataPath /tmp/shudeng-derived CODE_SIGNING_ALLOWED=NO -parallel-testing-enabled NO test
```

首次解析需要 GitHub 网络；可以指定已有的包缓存 `-clonedSourcePackagesDirPath /tmp/shudeng-readium-spm` 加速本机验证，但工程自身不依赖这个路径。

UI 用例通过正式文件选择器操作，不带测试启动参数。先把 `ios/ShudengTests/Fixtures/` 放到模拟器文件 App 的“我的 iPhone/Acceptance”；文件选择器保持在该文件夹或其上一级。存储单元测试使用独立临时目录，通过把 `library.json` 目标换成目录模拟真实文件系统写失败，验证回滚及恢复重试。

## 样书与许可

`original-fixture.epub` 来自本仓库原创隔离探针：3章、90段中英混合文本，含 C1-P01…C3-P30 标记、脚注和跨章链接，不含外部出版物内容。其他 fixture 由 `ruby scripts/create-test-fixtures.rb` 从该原件派生；仅测试目标包含它们，正式 app 不附带样书。模拟器 UI 测试保存截图至 xcresult，须同时核验屏幕原文与已提交 Locator。

`ThirdPartyNotices.txt` 随应用分发，可从“我的 / 第三方许可”阅读，包括 Readium、6个 Swift 依赖、Minizip/Info-ZIP、95个 JS 运行时包、Hypothesis 和保留字体/CSS 声明。没有使用 ReadAny 的实现、提示词、文案、资源或历史。最终 App Store Archive、真机性能及完整首发验收仍不在本票模拟器证据范围。
