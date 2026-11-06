# 书灯 UI 实验

分支：`codex/ui-design-demo`。用于在模拟器中快速判断视觉，定稿后重新整理为产品组件；这套样稿不直接合入正式版。

## 运行

在仓库根目录运行：

    pnpm --filter @shudeng/mobile demo:ios

可在命令末尾添加 shelf、notes、conversations、profile、reader 或 assistant，直接打开对应预览。默认 Small 模拟器；通过 IOS_SIMULATOR_UDID 指定其他已经启动的模拟器。

脚本复用最近一次 Release 原生包，只打包独立 JavaScript 入口。模拟器里安装为“书灯·UI”，bundle ID 为 dev.shudeng.visualdemo。依赖的原生包缺失时，先运行 scripts/build-ios-rn.sh Release。

## 样稿边界

- 书架、笔记、对话、阅读页和设置使用本地示例；搜索、折叠、引用展开、输入和设置选择只保留在内存。
- 问答使用 Gorhom 的半屏/全屏吸附和连续圆角；发送仅追加固定示例回答，不请求模型。
- 不加载产品路由、数据库、文件导入、密钥或真实 AI 服务。正式应用的源码与数据保持独立。
- 所有临时安装包集中到 .build/ui-demo/tmp-*，成功、失败和中断均由脚本回收；不保留重复原生包。

当前方向：纸白底、墨绿操作、少量灯光金；系统字体承担操作与层级，衬线留给书封和原文。参考其他阅读应用的内容比例与留白方法，不使用参考截图作为产品资产。

界面只保留帮助识别内容、操作和状态的文字；不在页头放阅读口号，也不在设置页解释设计理念。外观选项先于预览，详情页只保留一套导航标题。依据见 [Apple 设计原则研究](../../../../../docs/archive/research/2026-11-06/apple-interface-principles.md)。

检查设置子页时，可在运行命令前加 EXPO_PUBLIC_UI_DEMO_DETAIL=appearance（或 assistant、about），并使用 profile 页面参数；它只决定 Demo 的初始页面。
