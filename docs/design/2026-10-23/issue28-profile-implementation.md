# Issue #28：我的页面视觉闭环实施记录

状态：2026-10-24，实现与专项回归完成，等待独立验收。本记录不把其他页面并入“我的”页结论，也不代替验收代理关闭工单。

基准：[高保真原型](standalone.html)、[设计规格](spec.md)、[UIKit 界面开发规范](../ui-development-standard.md)。执行单：[GitHub Issue #28](https://github.com/andyWang1688/shudeng/issues/28)。

## 实现结果

- 根页面使用自定义左对齐 31pt“我的”标题，下方居中显示 70pt 原灯泡图标、20pt“书灯”、宋体品牌短句与 12pt 副文案。
- AI 服务、外观、关于书灯统一为最小 66pt 的细分隔设置行；每行有 20pt 单线图标、明确标题、右侧值与 44pt 以上触控区域。
- AI 服务行只呈现当前配置名称与模型摘要，不显示或读取密钥。未配置和读取失败分别给出明确反馈。
- 外观提供跟随系统、浅色、深色三项，切换后写入现有 `interface-style` 设置并立即更新窗口；重新进入页面后保持选择。
- “关于书灯”可进入品牌说明，并可继续进入现有第三方许可内容。
- 本地保存与外部发送边界保留在设置组下方的说明文字中。
- `ProfileBrandIconView` 根据当前 trait 更新边框色，浅色与深色下不会残留另一主题的边框。
- AI 服务详情页重新显示系统导航栏，解决自定义根页面隐藏导航栏后详情页无返回入口的问题。

## 证据

最终结果：[final.xcresult](../../../.scratch/test-evidence/issue28/final.xcresult)，3 tests / 0 failures；设备为 Shudeng Small（iPhone SE 3，iOS 26.5）。

- `DesignFixtureTests/testProfileUsesCenteredBrandDesignedSettingsAndPersistentAppearance`：品牌居中、左页头、三条设置行、服务摘要、未泄露密钥、外观持久化，以及四种尺寸/主题截图。
- `DesignFixtureTests/testProfileShowsUnconfiguredServiceWithoutReadingAKey`：空配置根目录显示“尚未配置，阅读仍可使用”，不访问真实 Keychain。
- `ReadingUITests/testIssue28ProfileBrandSettingsAndAbout`：Shudeng Small 上实际切换“我的”、打开外观选项并恢复跟随系统、进入 AI 服务再返回、进入关于书灯和第三方许可；覆盖浅色与深色。

截图由 [final-attachments](../../../.scratch/test-evidence/issue28/final-attachments/manifest.json) 导出：

| 状态 | 证据 |
| --- | --- |
| 375 × 667 浅色 | [profile-375x667-light](../../../.scratch/test-evidence/issue28/final-attachments/186C33A2-FF27-4A56-9BE9-4FA61978B9F6.png) |
| 375 × 667 深色 | [profile-375x667-dark](../../../.scratch/test-evidence/issue28/final-attachments/C24734AE-3DBD-46BB-A2BF-60607FD224D1.png) |
| 390 × 844 浅色 | [profile-390x844-light](../../../.scratch/test-evidence/issue28/final-attachments/DD6D0D4D-64B2-4066-932A-105F70AD63C1.png) |
| 390 × 844 深色 | [profile-390x844-dark](../../../.scratch/test-evidence/issue28/final-attachments/77ACDC94-615E-4850-B8E4-DF7728AB31DA.png) |
| 未配置服务 | [profile-unconfigured](../../../.scratch/test-evidence/issue28/final-attachments/A0455A91-4FC5-41C9-A437-DE070FAB8F70.png) |
| Shudeng Small 浅色 | [app-profile-light](../../../.scratch/test-evidence/issue28/final-attachments/A563A1D3-1D27-486E-B11B-C25D364B34E2.png) |
| Shudeng Small 深色 | [app-profile-dark](../../../.scratch/test-evidence/issue28/final-attachments/2DD2AD94-79EF-4ECF-8F85-E0ABFCD21853.png) |
| 辅助字号 XXXL | [profile-accessibility-xxxl](../../../.scratch/test-evidence/issue28/final-attachments/36503656-7A5F-4A27-B1C6-7B3185A29E71.png) |
| 关于书灯 | [about](../../../.scratch/test-evidence/issue28/final-attachments/934DA382-5209-4E62-8C14-F3F6E504FB13.png) |
| 确认稿对照 | [design-profile-375x667-light](../../../.scratch/test-evidence/design-profile-375x667-light.png) |

应用级截图裁除 20pt 系统状态栏；固定尺寸图由真实 UIKit 控制器渲染。

## 数据与兼容性

1. 本轮只改 UIKit 展示层和详情页导航栏出现时机，未修改 AI 配置结构、Keychain 读取路径、对话保存位置或接口协议。
2. 外观继续使用现有 `interface-style` 键；跟随系统、浅色、深色分别写入 `UIUserInterfaceStyle.unspecified/light/dark`。
3. 未配置服务测试使用临时目录和内存密钥实现，不读取用户真实 Key。
4. 关于页只读取既有版本号和第三方许可资源，不收集或发送数据。

## 允许差异与未验证边界

1. 390 × 844 是同一模拟器进程内的固定内容尺寸渲染，不创建第二台设备；系统状态栏不计入对照。
2. 外观选项使用系统 Action Sheet；这是样式控制选项的系统界面，不替代根页面设置行，关闭后行内值会反映选择。
3. 辅助字号 XXXL 下品牌与设置内容自然增高，页面保持可滚动；服务名称与模型改为分行，避免中间点单独折行。完整 VoiceOver 顺序、所有辅助字号的交互状态和真实系统大字号设备表现仍留给 #32。
4. 关于书灯和第三方许可是详情页，使用系统导航返回；设计根页的四栏外壳与平直底栏不受影响。
5. 本轮专项测试不证明真实 AI 回答质量、完整旧测试集、真机性能或商店分发通过。
