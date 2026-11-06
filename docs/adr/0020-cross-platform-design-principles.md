---
status: accepted
date: 2026-11-06
amends: ADR-0010 的固定视觉约束与 ADR-0014 的 UIKit 实现绑定
---

# 以 Apple 设计理念为依据，建立跨端设计规范

用户指出视觉 Demo 文案冗余、缺少设计取舍，并明确未来多端不能只服从 iOS 的控件与尺寸。决定以 Apple HIG 为主要设计依据，统一内容优先级、产品语义与视觉角色，再按目标平台选择导航、输入和辅助技术；相比全端复制一套外观，这增加平台适配工作，但能保留各端熟悉、可用的体验。

[跨端界面规范](../design/ui-development-standard.md)是设计、组件实现与视觉评审的当前正文。它取代旧规范中固定品牌口号、继续阅读卡片、自定义导航/底栏、全端固定色字尺寸、禁用系统语义色及仅允许 UIKit 等要求；阅读优先、渐进披露、成熟组件优先及已有保存、授权和问答生命周期继续有效，技术路线仍由 [ADR-0019](0019-react-native-langchain-architecture.md)管理。

功能冻结期间先用独立示例 Demo 确认目标端设计，再接真实业务；采纳原则不等于某份 Demo 已定稿，也不等于通过多端或可访问性验收。Apple 资源与平台专属能力不作为全端强制要求，Android、Web 及其他端开工时核对各自官方规范。

研究覆盖及阅读边界见 [HIG 阅读记录](../archive/research/2026-11-06/apple-hig-reading.md)；原逐条取代表和研究说明保存在[历史记录](../archive/planning/0020-design-principles-history.md)，未把研究完成当产品验收。
