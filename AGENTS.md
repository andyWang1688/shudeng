## Agent skills

### Issue tracker

任务与规格使用 GitHub Issues：andyWang1688/shudeng。执行相关技能前读取 `docs/agents/issue-tracker.md`。

### Triage labels

使用五个默认分诊标签。分诊前读取 `docs/agents/triage-labels.md`。

### Domain docs

使用单一领域布局：根目录 `GLOSSARY.md` 和 `docs/adr/`。探索或设计前读取 `docs/agents/domain.md`。

### Documentation

用户文档在 `website/doc/`（发布到 GitHub Pages），开发文档在 `docs/`（不发布）。写或改文档前读取 `docs/agents/documentation.md`。

### 发布流程

1. 在本地 `main` 完成合并，确认工作区干净、`main` 与 `origin/main` 一致。
2. 推送 `main`。文档站由 `.github/workflows/docs.yml` 自动构建并部署到 GitHub Pages；App 版本按 `delivery/` 的既有步骤构建安装包，并在 GitHub Releases 发布。
3. 验证：文档站返回 200，发布页的版本、安装包与说明一致。
4. 不要用 `git push <分支>:main` 绕过本地 `main`；先本地合并、再推送。


## 磁盘与临时资源管理

- **硬门槛：可用空间不足 30 GiB 时禁止新增大型构建**；构建前由 `scripts/build-ios-rn.sh` 检查并拒绝。
- 构建统一走 `scripts/build-ios-rn.sh [Debug|Release]`：固定复用 `.build/rn-ios/derived`，不把构建产物散落到 `/tmp`。
- 临时资源由脚本 `trap EXIT/INT/TERM` 回收；失败/中断删除本次临时目录，未完成 artifact 不得晋级。
- `.build` 总量上限默认 20 GiB，持久 artifact 上限 3 GiB，每个配置只保留最新一份 app；超限自动调用 `scripts/prune-project-artifacts.sh --build-only`。
- 历史清理统一用 `scripts/prune-project-artifacts.sh`：只删可再生产物与重复应用备份；保留唯一用户数据（书籍、阅读/问答/笔记数据库、密钥）和最新一份 `Shudeng.app` 备份；无法判断的跳过。
- `/private/tmp` 中属于书灯的派生产物由清理脚本回收；持久依赖不得放在系统临时目录。
- 涉及构建脚本的改动，验收必须覆盖连续两轮运行及失败清理，确认占用不会随运行次数增长。本次验收：`.build` 5.4→5.2 GiB，可用空间 68→68 GiB；失败模拟后无 `tmp-*` 残留。