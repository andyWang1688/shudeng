---
status: accepted
date: 2026-10-28
related: ADR-0014
---

# iOS 26 导航栏外观与大标题恢复

## 背景

iOS 26 上出现两个与系统大标题 / 自定义导航栏外观相关的回归：

1. 对话历史页点击搜索再取消后，顶部大标题“对话”不再绘制；AX 节点存在（exists/hittable、frame 正常）但屏幕墨迹为 0，滚动一次后恢复。
2. 自定义不透明 `UINavigationBarAppearance`（`BookDesign.install()` 全局设置）在「大标题 ↔ 搜索」状态切换后会遮挡大标题；Apple DTS 也建议 iOS 26 减少自定义导航栏背景（FB20986869 / forum 807331）。

## 决定

- 仅 iOS 26+：全局导航栏外观 `standard/compact` 保持纸白不透明，`scrollEdge/compactScrollEdge` 使用透明背景（纸白由各页 `view.backgroundColor` 承接）；iOS 16–25 完全保持旧逻辑。
- 列表页（笔记 / 对话历史）把导航栏外观委托给 `BookDesign.applyListPageNavigationAppearance(to:)`，避免逐页两份实现。
- 搜索取消后的 scroll-edge 状态恢复：`didDismissSearchController` 先还原搜索前 `contentOffset`，若搜索前处于列表顶部，则在后续 runloop 做一次 1pt 的两段式滚动 nudge（`top+1` → `top`）并触发导航栏布局，让系统重新计算大标题进度/alpha；用户可见位置不变。
- Profile 页统计分隔线等跨视图约束统一「先 addSubview 再 activate」，避免无共同祖先崩溃。

## 后果

- iOS 26 大标题与搜索交互恢复正常；其他 tab 的滚动到顶导航栏背景由纸白页面承接，视觉一致。
- iOS 16–25 分支仅编译、未运行验证（模拟器只有 iOS 26.5）。
- 该 workaround 依赖系统行为；升级 iOS 后如系统修复，可移除 nudge 逻辑。
