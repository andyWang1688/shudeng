---
status: accepted
date: 2026-10-15
---

# 使用 Readium，独立适配仿真卷页

首发采用 Readium Swift 3.11.0 处理可重排 EPUB，配合独立 UIKit 卷页适配及最小手势补丁；其持续维护、Swift 内容与定位接口以及隔离运行证据，比单看 Star 数更符合 iPhone 首发需要。相比已归档的 FolioReaderKit 和需要额外 Web 集成的 epub.js，此路线保留成熟阅读内核，同时接受卷页适配、锁版本和升级回归的维护成本；卷页不是开箱能力。

发行时排除已识别的旧字体并保留实际第三方许可声明；模拟器验证不等于真机性能或 App Store 验收。详见[选择依据](../../.scratch/first-release-decisions/issues/09-reader-final-choice.md)。
