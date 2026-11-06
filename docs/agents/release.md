# 合并与发布

仅在用户授权发布时执行。开发分支、视觉 Demo、测试通过和正式发布分别记录。

1. 在本地 main 合并目标改动；确认工作区干净，本地 main 与 origin/main 的差异只有本次待发布内容。
2. 推送本地 main，随后确认 main 与 origin/main 一致。使用本地合并流程，不通过 git push <分支>:main 绕过本地 main。
3. 文档站由 .github/workflows/docs.yml 在 website 改动合入 main 后自动部署；必要时按既有 workflow_dispatch 流程执行。App 按 delivery 中对应版本流程构建并在 GitHub Releases 发布。
4. 验证文档站返回 200；发布页版本、安装包、校验值与说明一致，明确模拟器、真机和商店分发边界。

构建和临时文件遵守[资源规则](resources.md)；用户文档只写已发布行为，维护规则见[文档约定](documentation.md)。历史安装和验收以[版本记录](../releases/)为准，不把新架构开发分支自动标成正式版。
