# #7 自带 AI 服务设置

## 支持的协议

“我的 → AI 服务”保存多套配置（独立 UUID、名称、格式、地址、模型、Keychain 引用），首套保存后选中；可编辑、选择已保存配置、删除。选择与检查均不隐式保存编辑内容，切换不接触书库、笔记或未来对话记录。删除当前项后不自动猜选另一项。

仅实现非流式文字连接检查：

| 格式 | POST 端点 | 鉴权／请求 | 成功解析 |
| --- | --- | --- | --- |
| OpenAI | Chat Completions，通常 /v1/chat/completions | Authorization: Bearer；model、messages、max_tokens=16、stream=false | choices[0].message.content 非空字符串 |
| Anthropic | Messages，通常 /v1/messages | x-api-key；anthropic-version=2023-06-01；同上四个请求字段 | content 中 type=text 的非空文字 |

固定检查文字是“Reply OK.”，不发送书内原文或历史；不会要求模型工具调用。检查成功仅表示本次文字请求可解析，不代表模型质量、完整问答、所有扩展或任意服务都兼容。支持 max_tokens 的上述契约；仅接受 Responses 或 max_completion_tokens 的服务不在本票兼容范围。没有流式、工具、音频、图像、嵌入、模型市场或问答页面。

地址允许 HTTPS，HTTP 仅允许 localhost、127.0.0.1 和 ::1 供本机测试；不接受 URL 中的用户名、密码、query 或 fragment。去掉末尾斜杠；若地址已以所选文字端点结尾，直接使用；否则空路径先设为 /v1，再追加 /chat/completions 或 /messages。自定义代理根路径必须由读者完整填写（例如 /gateway/v1）。拒绝重定向，不向新地址转发凭据；无持久化网络缓存和 Cookie。连接超时20秒，失败需主动重试，无静默重试或付费真实服务验证。

缺少模型／密钥、地址无效、401/403 鉴权、429 限流／额度、5xx/网络、其他状态／空文字／不匹配 JSON 分别给固定提示。不把响应原文、请求头、底层 error 或地址拼入提示；即使服务错误体回显凭据也不展示。配置读取失败只在设置页提供重试，阅读不依赖 AI 配置。

## 安全与保存

Keychain generic password，独立 service=dev.shudeng.ai-services，AfterFirstUnlockThisDeviceOnly，不开启同步。普通 ai-services.json 只存配置元数据、选择项与随机密钥引用；密钥输入遮蔽，编辑已有项不读回显示密钥，空输入保留旧密钥。密钥不进入普通存档、UserDefaults、自定义日志或导出。

更新密钥先新建 Keychain UUID 项并读回核验，再原子替换 ai-services.json，之后才发布内存成功。任一步失败不发布成功、不覆盖旧密钥；文件失败删除新项。进程中断在提交前最多留孤立密钥，提交后旧引用仍未删除时也不破坏已提交新项；下次加载／变更清理未引用项。安全存储暂不可用时保留文件和引用，选择／保存给出可重试错误，允许重填密钥修复。删除配置先提交元数据，再清理孤立密钥；清理失败下次重试，不冒险回滚已提交文件。

未来问答发送的问题、必要书内原文（可能含其他章节）和所需对话都会到所选地址；本地检索不等于问答全离线。列表和编辑／检查前均显示告知，检查也提示可能产生服务费用。本票不做真实服务、问答发送策略或历史容量处理。

## 限定验证

可控本机服务：ruby scripts/issue7-http-fixture.rb 18767，只记录格式、路径、模型、契约布尔值及状态，不记录密钥／正文；检查两种格式的实际 URL、头、四字段 JSON 与响应解析，含故意回显凭据的错误体、空响应、错误结构和禁止跳转。测试只用虚构凭据。

真实 Keychain 及实际文件故障在 AIServiceTests；AISecrets 注入仅用于 Keychain 写失败分支，不把注入当真实 Keychain 证明。真实 Keychain 测试覆盖两套重启切换、新密钥提交、JSON 写失败保留旧引用、重试不重复、缺失密钥修复、孤立项恢复清理及删除。UI 测试核实际填写／检查／选择／重启、空密钥编辑沿用 Keychain、鉴权提示、阅读仍可用；文件故障脚本动态找容器并临时 uchg，trap 解除，不卸载应用。

无签名模拟器默认没有 Keychain entitlement，securityd 返回 -34018。scripts/verify-ai-services.sh 仅在模拟器测试构建中通过 Mach-O __TEXT,__entitlements 提供 LOCALTEST 身份，并关闭调试 dylib 拆分，让身份进入主执行文件；继续 CODE_SIGNING_ALLOWED=NO，无 Apple 账号或普通文件密钥替代。测试脚本不改变产品签名；真机／分发仍需正常签名及其应用身份。新 runner 通过仅卸载测试 runner 获得；核对方法、耗时与附件，不接受0项通过。

实际命令、结果、脱敏证据、限制与设备清理见 .scratch/delivery/issue-7.md。开发验证不替代主控独立验收；真实服务由 #19 验证。
