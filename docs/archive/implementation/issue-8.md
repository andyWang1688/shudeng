# #8 书内资料准备与关键词搜索

- EPUB 成功入库后启动准备，应用启动也为已有书自动检查／续做；失败不影响阅读。书架与“目录与书签 → 书内搜索”显示真正已提交的章数、可用或失败；失败可重试，可用时可重新准备。准备、SQLite、分块和搜索在独立 actor，主线程只发布状态／界面。
- book-index.sqlite 仅存派生资料：preparations 的 SHA-256 book_id／版本／总章数／已提交章数，contents 的完整目录 JSON，chapters 的 reading-order 序号／href／标题，fragments 的书籍／章／段落序号、原文、Locator，fragment_terms 的 FTS5 索引。每章原文、FTS、章节和 checkpoint 单事务提交；中断丢弃未提交章，重开从 checkpoint 继续。重建只删除本书派生行，不接触 library.json、笔记／草稿／书签、进度或 AI Keychain／配置。
- 分块使用块元素间的连续 inline 原文，不跨章、不截断长段、不归一化空白；inline 标记合并，保留实体解码后的 DOM textContent。hidden、aria-hidden 与非正文元素及其嵌套后代不形成可搜索片段，但其原始字符仍计入 DOM offset／前后文；不会因删除隐藏字符而错位。外部 CSS 自定义隐藏规则尚未做渲染级过滤。
- 中文不采用词典分词，使用 Unicode 字符一元／二元 FTS5 候选索引；英文共用字符索引，支持大小写及重音不敏感的字面子串。多字查询以二元项交集筛选，再对原文实际匹配，消除组合假阳性。仅当前 book_id，按章／片段／出现位置排序；每个不重叠出现位置独立结果，不做语义、跨书或高级搜索配置。
- 每条片段保存真实资源、元素 CSS 路径、完整前后文及 text-node 子节点与 UTF-16 偏移映射；命中转为准确 DOMRange 和原文 quote。相同句在同段第二次、另一段或另一章不合并；字号、模式、页码不参与身份。目录、书签、笔记仍使用既有共用导航／准确字符可视核验与卷页缓存失效。
- Readium 3.11.0 同页 go 可能因滚动比例未变而不发新的回调，留下 pending Locator。增加最小 refreshLocationFromViewport() 扩展，在 idle 状态使用原有原生视口计算；导航完成且越过已有 debounce 后刷新，准确原文可见及原生位置无临时 quote／DOMRange 才保存／建缓存。升级须复核本扩展，不以超时判成功，版本仍为3.11.0。
- #10 接入同一 BookIndex 准备流程及 SQLite 已提交 fragments／chapters／Locator 契约；应按书籍、索引版本及片段身份保存自己的派生向量并复用 checkpoint。此票不实现嵌入、向量模型、AI 生成、问答、备份或同步；不改 #7 配置及密钥。

原创样书由 scripts/create-search-fixtures.rb 生成，含长段内两次相同中英句、跨章、inline／实体／emoji／重音、嵌套 hidden、另一本书及40章长书；仅测试 Fixtures 包含。存储测试包含真实 SQLite journal 初始化写失败及数据库 trigger 在下一章插入三条后中止事务，无产品故障钩子。正式 UI 使用 Files 导入及真实点击。故障／续做脚本为 verify-index-failure.sh、verify-index-resume.sh；沿用 verify-ai-services.sh 模拟器 Keychain 身份，不替换 #7 安全存储。

实际命令、截图／SQLite 与失败包边界见 .scratch/delivery/issue-8.md。开发验证不替代独立验收；真机、iOS16、多样 EPUB／复杂 CSS／RTL／竖排、内存压力与真实长书性能未验证。
