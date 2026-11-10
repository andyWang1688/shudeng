# 模型设置交互 Demo

后续设计反馈（2026-11-10）：用户已否决本提案。将“我的”改名为“设置”并收窄为模型与关于入口的方向不再推进；当前内容归属见[我的与设置](../../product-scope.md#我的与设置)。下方保留制作时的实际操作结果，不作为视觉设计获准或产品接线通过的证据。

任务 [#60](https://github.com/andyWang1688/shudeng/issues/60)。问题是模型切换、编辑和保存混在一起，普通配置藏在高级页。本轮只制作独立可点击提案，待用户判断交互；没有接入真实配置。

环境：2026-11-10（本机 Asia/Shanghai），Small / iPhone SE 3 / iOS 26.5，375 × 667 pt。工作分支 codex/ui-product-integration，基点 d663a77，工作区仍有此前未提交改动；本轮主要源码为 DemoModelSettings.tsx、DemoProfile.tsx 与 VisualDemo.tsx。通过 demo:ios 复用 Release 底包，未新增原生构建。包 dev.shudeng.visualdemo，显示名称“书灯·UI”，独立于产品开发包。

## 操作检查

| 输入与操作 | 预期与观察 |
| --- | --- |
| 默认 DeepSeek；编辑 OpenAI 名称，进入高级再返回，保存 | 草稿保留；新名称出现在列表，DeepSeek 仍选中。再点选 OpenAI 时才切换。 |
| 修改后取消，分别选择继续编辑、放弃修改、保存 | 继续编辑保留草稿；放弃返回原名称；保存新增示例后返回列表，新增项未被自动选中。 |
| 新增不填 Key 点击保存，再填写 demo 并保存 | 空值保留编辑器并显示必填提示；填写后新增成功。最终版明文示例输入保存后未再出现系统密码储存弹窗。 |
| 选中新增 Demo，编辑并删除 | 先确认；删除后两条原有模型均未选中。手动点选 DeepSeek 才恢复选中。 |
| 软件键盘打开，聚焦示例 Key，随后取消 | 输入框与顶部保存均可见，未修改时直接返回；已取消未保存的编辑不污染列表。 |

移动端类型检查通过，改动文件 diff 空白检查通过。没有添加镜像实现的自动化测试；本轮以设备操作检查原型交互。

## 过程中修正

最初 KeyboardAvoidingView 下，Key 文本贴住键盘附件栏；改用 React Native ScrollView 的 automaticallyAdjustKeyboardInsets 后，软件键盘下输入可见。最初安全输入被 iOS 识别为账号密码并提示储存；本原型改为明确标识“仅示例”的普通输入，不涉及真实 Key。正式版本仍需单独实现并验证安全输入及本机安全保存，不能直接照搬此原型的输入方式。

设备操作使用 Device Hub 的可访问性入口；XcodeBuildMCP 负责截图。当前环境下 MCP tap 返回成功但画面未导航，因此没有把工具返回成功当成点击通过。

## 证据与边界

- [模型列表](model-settings-demo/models.jpg)：DeepSeek 选中，独立编辑按钮及新增入口。
- [编辑表单](model-settings-demo/editor.jpg)：基本字段直接展示，搜索跟随模型，高级入口单独保留。
- [软件键盘](model-settings-demo/keyboard.jpg)：Key 栏与顶部保存同时可见。

未验证：真实服务请求、Key 安全保存、网络失败、真实模型联网能力、上下文窗口适配、索引下载、MCP、Android/Web、大字号与完整读屏流程。示例里的服务地址和模型 ID 仅供演示布局，不是最新型号或服务能力推荐。重启会恢复样本，不能据此声称持久化通过。制作时尚未获确认、未发布或提交；后续否决反馈见本文开头。

Small 最后停在“书灯·UI → 模型”列表，保留 DeepSeek 与 OpenAI 两个样本，DeepSeek 选中。
