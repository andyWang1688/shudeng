# Issue tracker

- Tracker: GitHub Issues
- Repository: andyWang1688/shudeng
- CLI: gh；所有操作显式指定仓库。
- PRs as a request surface: no

## 常用操作

- 创建：`gh issue create --repo andyWang1688/shudeng --title '标题' --body-file /tmp/issue-body.md`
- 读取：`gh issue view <number> --repo andyWang1688/shudeng --comments`
- 列表：`gh issue list --repo andyWang1688/shudeng --state open`
- 评论：`gh issue comment <number> --repo andyWang1688/shudeng --body-file /tmp/comment-body.md`
- 修改标签：`gh issue edit <number> --repo andyWang1688/shudeng --add-label <label>`
- 认领：`gh issue edit <number> --repo andyWang1688/shudeng --add-assignee @me`
- 关闭：`gh issue close <number> --repo andyWang1688/shudeng`

多行正文先写入临时文件，再使用 `--body-file`。技能中的“发布”指创建 GitHub Issue。

## Wayfinder

地图对应一个 Issue，标签为 `wayfinder:map`；子问题使用 `wayfinder:research`、`wayfinder:prototype`、`wayfinder:grilling` 或 `wayfinder:task`，按需创建这些标签。

优先使用 GitHub 原生子 Issue 和依赖关系。先用 `gh api repos/andyWang1688/shudeng/issues/<number> --jq .id` 读取目标 Issue 的数据库 ID。

- 子 Issue：`gh api --method POST repos/andyWang1688/shudeng/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`
- 阻塞依赖：`gh api --method POST repos/andyWang1688/shudeng/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`

若服务明确不支持原生关系，在正文保留父子链接和 `Blocked by: #N`；认证、权限或网络错误应先解决，不能当成接口不支持。
解决子问题后记录结论、关闭 Issue，并更新地图。

现有 `.scratch/first-release-decisions/` 保留为历史探索证据；新任务在 GitHub 跟踪。本次配置不迁移历史记录，也不创建产品任务。
