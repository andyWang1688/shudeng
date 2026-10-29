# 书灯视觉系统 v1 · 纸与灯（草案）

2026-10-27 设计基准草案，等待用户确认；确认前不改实现。

- 文字规范：[visual-system.md](visual-system.md)
- 可交互预览（单文件、离线）：[visual-system.html](visual-system.html)
- 渲染证据：[evidence/](evidence/)
- 对照：上一版界面快照在 [../current-ui/](../current-ui/)

## 打开预览

直接双击 `visual-system.html`，或在浏览器里打开：

```sh
open docs/design/2026-10-27/visual-system/visual-system.html
```

预览里包含：颜色 / 字体 / 间距 / 圆角 / 阴影规范、书封系统、图标、应用图标三方案，以及 375×667 浅色与深色、390×844 三个整页看板。

只渲染一个区域（调试用）：

```sh
# 单页，2x：?solo=shelf&theme=light&w=375&h=667
open "docs/design/2026-10-27/visual-system/visual-system.html?solo=shelf&theme=light&w=375&h=667"
# 看板：?board=light375 | dark375 | light390 | icons | specimen
open "docs/design/2026-10-27/visual-system/visual-system.html?board=dark375"
```

## 重新生成证据

```sh
bash docs/design/2026-10-27/visual-system/render.sh
```

依赖 macOS 本机 Google Chrome（headless）与本地系统字体（Songti SC / PingFang SC），不联网、不引入新依赖。渲染产物写入 `evidence/`。

## 证据文件

| 文件 | 内容 |
| --- | --- |
| `board-light-375.png` | 375×667 浅色 6 页看板 |
| `board-dark-375.png` | 375×667 深色 6 页看板 |
| `board-light-390.png` | 390×844 浅色看板（书架 / 阅读 / 问答） |
| `solo` 系列 `@2x` | 单页 2 倍图，便于看排版细节 |
| `icons.png` | 应用图标三方案 |
| `specimen-p1/p2/p3.png` | 颜色、字体、间距、书封、图标、原则、无障碍 |

## 边界

- 预览是 HTML 高保真稿，不是原生实现；字体用系统宋体 / 苹方模拟 iOS 效果。
- 夹具书籍没有真实封面，因此示例使用“书封回退”方案；真实 EPUB 封面优先。
- 预览不含阅读页的三种翻页模式、AI 请求与保存流程；这些行为沿用现有实现与验收。
