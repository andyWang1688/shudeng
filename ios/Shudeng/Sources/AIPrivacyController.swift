import UIKit

final class AIPrivacyController: UITableViewController {
    enum Content { case policy, sending }
    private let content: Content

    init(content: Content = .policy) {
        self.content = content
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    static func sendNotice(for configuration: AIConfiguration) -> String {
        // Show only a validated destination host, never credentials, query strings or private paths.
        let host = (try? AIConnection.endpoint(for: configuration))?.host ?? "所选服务地址"
        return "问题、相关原文和必要对话将发送到“\(configuration.name)”（\(host)），可能产生服务费用。"
    }

    private var paragraphs: [(String, String)] {
        if content == .sending {
            return [
                ("发送哪些内容", "阅读问答会发送你的问题、相关书内原文和理解追问所需的对话历史；原文可能来自其他章节。本机检索不表示 AI 回答全程离线，也不表示每次发送整本书。"),
                ("发送给谁", "请求直接发往你配置的 AI 服务地址。使用代理地址时，代理也可能接收这些内容；请只选择你信任的服务。地址、服务商或接口格式改变后需要重新确认发送说明。"),
                ("费用与检查", "书灯不提供或代付 AI 服务，服务商可能按其规则收费。检查连接仅发送固定短文字，不发送书内原文；检查成功不会保存配置或 API Key。"),
                ("你的选择", "保存或切换服务前可以取消。未配置 AI 或未确认发送说明，不影响本机阅读、笔记、书签和离线回看。更多保留与使用边界见“我的 → 关于书灯 → 隐私政策”。")
            ]
        }
        return [
            ("本机存储", "书灯将导入的书籍、阅读位置、笔记、书签、书内检索资料和问答记录存储在本机。API Key 存储在设备 Keychain，不写入书灯导出的阅读数据。请妥善保管你自行导出的文件及设备备份。"),
            ("外部 AI 服务", "使用 AI 问答时，问题、相关原文和必要对话会发送到你所选的服务地址；相关原文可能来自其他章节。自定义代理也可能接收请求。保存或切换服务时确认发送说明，地址、服务商或接口格式改变时重新确认。连接检查会发送固定短文字。"),
            ("服务费用", "AI 服务由你自行配置，可能按请求或用量收费。检查连接也可能产生费用。书灯不提供、代付或保证第三方额度，请查看所选服务的价格与条款。"),
            ("保留与删除", "本机阅读资料和问答记录会保留供你回看，直到你删除相应内容或由系统移除应用数据。自行导出的副本需自行删除。删除 AI 服务会尝试清理对应 Keychain 条目；卸载应用不保证清除 Keychain。发送到第三方的内容按该服务的政策保留，书灯无法代为保证其删除或保留期限。"),
            ("使用边界", "本机检索不意味着 AI 全程离线。AI 回答可能不准确，有限的原文片段不代表完整阅读全书；请核对引用和原文。发送书内内容前请确认你有相应使用权限。此页说明当前产品行为，不代表已经过法律审查。")
        ]
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = content == .policy ? "隐私政策" : "AI 服务发送说明"
        navigationItem.largeTitleDisplayMode = .never
        BookDesign.table(tableView)
        tableView.accessibilityIdentifier = content == .policy ? "privacy-policy" : "ai-sending-details"
    }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { paragraphs.count }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let (heading, body) = paragraphs[indexPath.row]
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        var configuration = cell.defaultContentConfiguration()
        configuration.text = heading; configuration.secondaryText = body
        configuration.textProperties.font = .preferredFont(forTextStyle: .headline)
        configuration.secondaryTextProperties.font = .preferredFont(forTextStyle: .body)
        configuration.textProperties.numberOfLines = 0; configuration.secondaryTextProperties.numberOfLines = 0
        configuration.textToSecondaryTextVerticalPadding = 8
        cell.contentConfiguration = configuration
        cell.selectionStyle = .none
        return cell
    }
}
