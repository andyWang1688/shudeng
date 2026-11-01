import UIKit

// MARK: - 外部工具配置页（iOS 17+）

@available(iOS 17.0, *)
final class MCPServerEditorController: UITableViewController {
    private var server: MCPServerConfiguration
    private let isNew: Bool
    private let store: MCPServerStore
    private let manager: MCPClientManager
    private var discoveryTask: Task<Void, Never>?
    private var statusText: String?
    private var isDiscovering = false
    private weak var nameField: UITextField?
    private weak var endpointField: UITextField?

    init(server: MCPServerConfiguration, isNew: Bool, store: MCPServerStore,
         manager: MCPClientManager = .shared) {
        self.server = server
        self.isNew = isNew
        self.store = store
        self.manager = manager
        super.init(style: .insetGrouped)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = isNew ? "添加外部工具" : "外部工具"
        BookDesign.formTable(tableView)
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "ai-value")
        tableView.register(MCPTextFieldCell.self, forCellReuseIdentifier: "mcp-field")
        tableView.register(MCPToolCell.self, forCellReuseIdentifier: "mcp-tool")
        tableView.accessibilityIdentifier = "mcp-settings"
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            title: "保存", style: .done, target: self, action: #selector(save)
        )
    }

    deinit { discoveryTask?.cancel() }

    private var sections: [String] { isNew ? ["连接", "可用工具"] : ["连接", "可用工具", "管理"] }

    override func numberOfSections(in tableView: UITableView) -> Int { sections.count }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        switch section {
        case 0: return 5
        case 1: return server.knownTools.isEmpty ? 1 : 1 + server.knownTools.count
        default: return 1
        }
    }

    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        sections[section]
    }

    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        switch section {
        case 0:
            return "只支持 https 地址；本机测试可用 http://127.0.0.1。自定义 Header 仅保存在本机，用于该服务鉴权；不会保存或发送 AI Key、书库内容。"
        case 1:
            if let statusText { return statusText }
            return server.knownTools.isEmpty
                ? "先保存并启用连接，再读取这个服务提供的工具。外部工具默认关闭，只有打开开关的工具才会交给 AI。"
                : "只有打开开关的工具才会交给 AI；只读工具优先。首次调用前仍会再次请求确认。"
        default:
            return nil
        }
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        if indexPath.section == 0 {
            switch indexPath.row {
            case 0:
                let cell = tableView.dequeueReusableCell(withIdentifier: "mcp-field", for: indexPath) as! MCPTextFieldCell
                cell.configure(title: "名称", placeholder: "例如：我的搜索", text: server.name,
                               identifier: "mcp-name-field", contentType: .name) { [weak self] text in
                    self?.server.name = text
                }
                nameField = cell.field
                return cell
            case 1:
                let cell = tableView.dequeueReusableCell(withIdentifier: "mcp-field", for: indexPath) as! MCPTextFieldCell
                cell.configure(title: "地址", placeholder: "https://example.com/mcp", text: server.endpoint,
                               identifier: "mcp-endpoint-field", contentType: .URL, keyboardType: .URL) { [weak self] text in
                    self?.server.endpoint = text
                }
                endpointField = cell.field
                return cell
            case 2:
                let cell = tableView.dequeueReusableCell(withIdentifier: "ai-value", for: indexPath)
                var content = UIListContentConfiguration.valueCell()
                content.text = "传输方式"
                content.textProperties.font = BookType.body
                content.textProperties.color = BookDesign.ink
                content.secondaryText = server.transport.displayName
                content.secondaryTextProperties.font = BookType.footnote
                content.secondaryTextProperties.color = BookDesign.ink3
                cell.contentConfiguration = content
                cell.accessoryType = .none
                cell.selectionStyle = .default
                cell.accessibilityIdentifier = "mcp-transport"
                return cell
            case 3:
                let cell = tableView.dequeueReusableCell(withIdentifier: "mcp-field", for: indexPath) as! MCPTextFieldCell
                let existing = server.headers?.first.map { "\($0.key): \($0.value)" } ?? ""
                cell.configure(title: "请求 Header", placeholder: "可选，如 Authorization: Bearer …", text: existing,
                               identifier: "mcp-header-field", contentType: nil) { [weak self] text in
                    guard let self else { return }
                    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard let separator = trimmed.firstIndex(of: ":") else {
                        self.server.headers = nil
                        return
                    }
                    let name = trimmed[..<separator].trimmingCharacters(in: .whitespaces)
                    let value = trimmed[trimmed.index(after: separator)...].trimmingCharacters(in: .whitespaces)
                    if name.isEmpty || value.isEmpty {
                        self.server.headers = nil
                    } else {
                        self.server.headers = [name: value]
                    }
                }
                return cell
            default:
                let cell = tableView.dequeueReusableCell(withIdentifier: "ai-value", for: indexPath)
                var content = UIListContentConfiguration.valueCell()
                content.text = "启用外部工具"
                content.textProperties.font = BookType.body
                content.textProperties.color = BookDesign.ink
                content.secondaryText = server.isEnabled ? "已启用" : "默认关闭"
                content.secondaryTextProperties.font = BookType.footnote
                content.secondaryTextProperties.color = BookDesign.ink3
                cell.contentConfiguration = content
                let toggle = UISwitch()
                toggle.isOn = server.isEnabled
                toggle.onTintColor = BookDesign.lampInk
                toggle.accessibilityIdentifier = "mcp-enabled"
                toggle.addTarget(self, action: #selector(enabledChanged(_:)), for: .valueChanged)
                cell.accessoryView = toggle
                cell.selectionStyle = .none
                return cell
            }
        }
        if indexPath.section == 1 {
            if indexPath.row == 0 {
                let cell = tableView.dequeueReusableCell(withIdentifier: "ai-value", for: indexPath)
                var content = UIListContentConfiguration.valueCell()
                content.text = isDiscovering ? "正在读取工具…" : "读取可用工具"
                content.textProperties.font = BookType.sans(15, weight: .medium, style: .body)
                content.textProperties.color = BookDesign.lampInk
                content.secondaryText = server.knownTools.isEmpty ? "需要已保存的启用连接" : "\(server.knownTools.count) 个"
                content.secondaryTextProperties.font = BookType.footnote
                content.secondaryTextProperties.color = BookDesign.ink3
                cell.contentConfiguration = content
                if let statusText {
                    cell.accessibilityValue = statusText
                }
                cell.accessibilityIdentifier = "mcp-discover-tools"
                cell.selectionStyle = .default
                return cell
            }
            guard indexPath.row - 1 < server.knownTools.count else { return UITableViewCell() }
            let tool = server.knownTools[indexPath.row - 1]
            let cell = tableView.dequeueReusableCell(withIdentifier: "mcp-tool", for: indexPath) as! MCPToolCell
            cell.configure(
                tool: tool,
                isAllowed: server.allowedTools.contains(tool.name),
                anyChanged: !server.allowedTools.isEmpty
            ) { [weak self] allowed in
                guard let self else { return }
                if allowed { self.server.allowedTools.insert(tool.name) } else { self.server.allowedTools.remove(tool.name) }
                self.store.update(self.server)
            }
            return cell
        }
        let cell = tableView.dequeueReusableCell(withIdentifier: "ai-value", for: indexPath)
        var content = UIListContentConfiguration.cell()
        content.text = "删除这个外部工具"
        content.textProperties.font = BookType.body
        content.textProperties.color = BookDesign.error
        content.textProperties.alignment = .center
        cell.contentConfiguration = content
        cell.accessibilityIdentifier = "mcp-delete-server"
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        if indexPath.section == 0 && indexPath.row == 2 {
            chooseTransport()
        } else if indexPath.section == 1 && indexPath.row == 0 {
            discoverTools()
        } else if indexPath.section == 2 && !isNew {
            confirmDelete()
        }
    }

    override func tableView(_ tableView: UITableView,
                            trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        nil
    }

    // MARK: - Actions

    @objc private func enabledChanged(_ sender: UISwitch) {
        server.isEnabled = sender.isOn
        if sender.isOn && server.endpointURL != nil && !isNew {
            store.update(server)
            discoverTools()
        } else {
            reloadPreservingLayout()
        }
    }

    private func chooseTransport() {
        let alert = BookAlertController(title: "传输方式", message: nil, preferredStyle: .actionSheet)
        for kind in MCPTransportKind.allCases {
            alert.addAction(BookAlertAction(title: kind.displayName, style: .default) { [weak self] _ in
                guard let self else { return }
                self.server.transport = kind
                Task { await self.manager.disconnect(serverID: self.server.id) }
                self.reloadPreservingLayout()
            })
        }
        alert.addAction(BookAlertAction(title: "取消", style: .cancel))
        present(alert, animated: true)
    }

    private func discoverTools() {
        guard !isDiscovering else { return }
        guard let url = server.endpointURL else {
            statusText = "地址无效：只支持 https；本机测试可用 http://127.0.0.1。"
            tableView.reloadData()
            return
        }
        guard server.isEnabled else {
            statusText = "请先启用这个外部工具，再读取工具。"
            tableView.reloadData()
            return
        }
        isDiscovering = true
        statusText = "正在连接 \(url.host ?? "服务")…"
        reloadPreservingLayout()
        discoveryTask = Task { [weak self] in
            guard let self else { return }
            do {
                let tools = try await manager.discoverTools(for: server)
                await MainActor.run {
                    self.server.knownTools = tools.sorted { $0.name < $1.name }
                    self.server.lastError = nil
                    self.statusText = tools.isEmpty ? "这个服务没有提供工具。" : "已读取 \(tools.count) 个工具。"
                    self.isDiscovering = false
                    self.store.update(self.server)
                    self.reloadPreservingLayout()
                }
            } catch {
                await MainActor.run {
                    self.server.lastError = (error as? LocalizedError)?.errorDescription ?? "连接失败"
                    self.statusText = self.server.lastError
                    self.isDiscovering = false
                    self.store.update(self.server)
                    self.reloadPreservingLayout()
                }
            }
        }
    }

    @objc private func save() {
        let name = server.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return presentError("请填写名称。") }
        server.name = name
        guard let url = MCPServerConfiguration.normalizedURL(server.endpoint) else {
            return presentError("地址无效：只支持 https；本机测试可用 http://127.0.0.1。")
        }
        server.endpoint = url.absoluteString
        server.knownTools = server.knownTools.filter { !$0.name.isEmpty }
        let old = store.load().first { $0.id == server.id }
        if old?.endpoint != server.endpoint || old?.transport != server.transport {
            Task { await manager.disconnect(serverID: server.id) }
        }
        store.update(server)
        if isNew {
            navigationController?.popViewController(animated: true)
        } else {
            statusText = "已保存。"
            reloadPreservingLayout()
        }
    }

    private func confirmDelete() {
        let alert = BookAlertController(title: "删除这个外部工具？", message: "删除后不会再向它发送任何内容；书内问答不受影响。", preferredStyle: .alert)
        alert.addAction(BookAlertAction(title: "取消", style: .cancel))
        alert.addAction(BookAlertAction(title: "删除", style: .destructive) { [weak self] _ in
            guard let self else { return }
            Task { await self.manager.disconnect(serverID: self.server.id) }
            self.store.remove(id: self.server.id)
            self.navigationController?.popViewController(animated: true)
        })
        present(alert, animated: true)
    }

    private func presentError(_ message: String) {
        statusText = message
        tableView.reloadData()
    }

    private func reloadPreservingLayout() {
        UIView.performWithoutAnimation {
            tableView.reloadData()
        }
    }
}

// MARK: - Cells

@available(iOS 17.0, *)
private final class MCPTextFieldCell: UITableViewCell {
    let field = UITextField()
    private let titleLabel = UILabel()
    private var onChange: ((String) -> Void)?
    private var configuredIdentifier: String?

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        selectionStyle = .none
        backgroundColor = BookDesign.surface
        titleLabel.font = BookType.footnote
        titleLabel.textColor = BookDesign.ink3
        titleLabel.setContentHuggingPriority(.required, for: .horizontal)
        field.font = BookType.body
        field.textColor = BookDesign.ink
        field.autocorrectionType = .no
        field.autocapitalizationType = .none
        field.clearButtonMode = .whileEditing
        field.addTarget(self, action: #selector(editingChanged), for: .editingChanged)
        for child in [titleLabel, field] {
            child.translatesAutoresizingMaskIntoConstraints = false
            contentView.addSubview(child)
        }
        NSLayoutConstraint.activate([
            titleLabel.leadingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.leadingAnchor),
            titleLabel.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
            titleLabel.widthAnchor.constraint(greaterThanOrEqualToConstant: 68),
            field.leadingAnchor.constraint(equalTo: titleLabel.trailingAnchor, constant: 12),
            field.trailingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.trailingAnchor),
            field.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 4),
            field.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -4),
            contentView.heightAnchor.constraint(greaterThanOrEqualToConstant: 52)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func configure(title: String, placeholder: String, text: String, identifier: String,
                   contentType: UITextContentType?, keyboardType: UIKeyboardType = .default,
                   onChange: @escaping (String) -> Void) {
        titleLabel.text = title
        field.placeholder = placeholder
        field.text = text
        field.textContentType = contentType
        field.keyboardType = keyboardType
        field.accessibilityIdentifier = identifier
        self.onChange = onChange
    }

    @objc private func editingChanged() { onChange?(field.text ?? "") }
}

@available(iOS 17.0, *)
private final class MCPToolCell: UITableViewCell {
    private var toggle: UISwitch!
    private var onToggle: ((Bool) -> Void)?
    private var toolName = ""

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        selectionStyle = .none
        backgroundColor = BookDesign.surface
        toggle = UISwitch()
        toggle.onTintColor = BookDesign.lampInk
        toggle.addTarget(self, action: #selector(changed), for: .valueChanged)
        accessoryView = toggle
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func configure(tool: MCPToolDescriptor, isAllowed: Bool, anyChanged: Bool,
                   onToggle: @escaping (Bool) -> Void) {
        var content = UIListContentConfiguration.subtitleCell()
        content.text = tool.displayName
        content.textProperties.font = BookType.body
        content.textProperties.color = BookDesign.ink
        content.secondaryText = (tool.readOnly ? "只读" : "可写，请谨慎授权")
            + (tool.description.map { " · \($0)" } ?? "")
        content.secondaryTextProperties.font = BookType.footnote
        content.secondaryTextProperties.color = tool.readOnly ? BookDesign.ink3 : BookDesign.error
        content.secondaryTextProperties.numberOfLines = 2
        content.image = BookDesign.symbol(tool.readOnly ? "lock.open" : "exclamationmark.triangle", size: 16)
        content.imageProperties.tintColor = tool.readOnly ? BookDesign.lampInk : BookDesign.error
        contentConfiguration = content
        toolName = tool.name
        toggle.isOn = isAllowed
        toggle.accessibilityIdentifier = "mcp-tool-" + tool.name
        toggle.accessibilityLabel = tool.displayName
        self.onToggle = onToggle
    }

    @objc private func changed() { onToggle?(toggle.isOn) }
}
