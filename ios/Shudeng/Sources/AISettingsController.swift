import UIKit

final class AISettingsController: UITableViewController {
    private let root: URL
    private let secrets: AISecrets
    private var store: AIConfigurationStore?
    private var failure: String?
    private let disclosure = "阅读问答时，你的问题、必要书内原文（可能来自其他章节）及所需对话会发送到你所选的服务地址。本地检索不代表问答全离线。连接检查仅发送固定短文字，也可能产生服务费用。书灯不提供或代付 AI 服务。"
    init(root: URL, secrets: AISecrets = KeychainSecrets()) {
        self.root = root
        self.secrets = secrets
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "AI 服务"
        BookDesign.table(tableView)
        tableView.accessibilityIdentifier = "ai-services"
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "添加", style: .plain, target: self, action: #selector(add))
        load()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(false, animated: false)
    }

    private func load() {
        do { store = try AIConfigurationStore(root: root, secrets: secrets); failure = nil }
        catch { failure = "配置读取失败，已有内容未覆盖。点此重试；阅读仍可使用。" }
        navigationItem.rightBarButtonItem?.isEnabled = store != nil
        tableView.reloadData()
    }
    override func numberOfSections(in tableView: UITableView) -> Int { 2 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        section == 0 ? max(store?.configurations.count ?? 0, 1) : 1
    }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        section == 0 ? "已保存的配置" : "数据去向与支持范围"
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.numberOfLines = 0
        cell.detailTextLabel?.numberOfLines = 0
        if indexPath.section == 1 {
            cell.textLabel?.text = disclosure
            cell.detailTextLabel?.text = "支持 OpenAI Chat Completions、Anthropic Messages 非流式文字接口；不支持 Responses、工具调用、语音、图片及服务扩展。HTTPS 地址，API 根地址或完整文字端点。"
            cell.selectionStyle = .none
        } else if let store, !store.configurations.isEmpty {
            let configuration = store.configurations[indexPath.row]
            cell.textLabel?.text = configuration.name + (store.selectedID == configuration.id ? " · 使用中" : "")
            cell.detailTextLabel?.text = configuration.format.rawValue + " · " + configuration.model
            cell.accessoryType = .disclosureIndicator
            cell.accessibilityIdentifier = "ai-config-" + configuration.id.uuidString
        } else {
            cell.textLabel?.text = failure ?? "尚未配置 AI 服务，仍可正常阅读。"
        }
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard indexPath.section == 0 else { return }
        guard let store else { load(); return }
        if !store.configurations.isEmpty { edit(store.configurations[indexPath.row]) }
    }
    @objc private func add() { edit(nil) }
    private func edit(_ configuration: AIConfiguration?) {
        guard let store else { return }
        let editor = AIConfigurationController(store: store, configuration: configuration) { [weak self] in self?.tableView.reloadData() }
        let nav = UINavigationController(rootViewController: editor)
        nav.isModalInPresentation = true
        present(nav, animated: true)
    }
}

private final class AIConfigurationController: UITableViewController {
    private let store: AIConfigurationStore
    private let changed: () -> Void
    private let original: AIConfiguration?
    private var draft: AIConfiguration
    private let name = UITextField()
    private let address = UITextField()
    private let model = UITextField()
    private let key = UITextField()
    private var checking = false
    private var status = "未检查；检查成功不代表配置已保存。"
    private var checkTask: Task<Void, Never>?
    init(store: AIConfigurationStore, configuration: AIConfiguration?, changed: @escaping () -> Void) {
        self.store = store; self.original = configuration; self.changed = changed
        draft = configuration ?? AIConfiguration(name: "", format: .openAI, address: "", model: "")
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = original == nil ? "添加服务" : "编辑服务"
        tableView.accessibilityIdentifier = "ai-service-editor"
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "取消", style: .plain, target: self, action: #selector(cancel))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "保存", style: .done, target: self, action: #selector(save))
        tableView.keyboardDismissMode = .onDrag
        for (field, placeholder, value, id) in [
            (name, "配置名称", draft.name, "ai-name"), (address, "API 根地址或完整端点", draft.address, "ai-address"),
            (model, "模型 ID", draft.model, "ai-model"), (key, original == nil ? "密钥" : "留空保留已保存的密钥", "", "ai-key")
        ] {
            field.placeholder = placeholder; field.text = value; field.accessibilityIdentifier = id
            field.accessibilityLabel = placeholder
            field.font = .preferredFont(forTextStyle: .body); field.adjustsFontForContentSizeCategory = true
            field.autocorrectionType = .no; field.autocapitalizationType = .none
            field.addTarget(self, action: #selector(edited), for: .editingChanged)
            field.addTarget(self, action: #selector(finishEditing), for: .editingDidEndOnExit)
        }
        address.keyboardType = .URL
        key.isSecureTextEntry = true
        key.textContentType = nil
    }
    override func numberOfSections(in tableView: UITableView) -> Int { 3 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { section == 0 ? 5 : section == 1 ? 2 : (original == nil ? 0 : 2) }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        if section == 0 { return "密钥保存在设备 Keychain。服务地址中不要填密钥。空路径自动使用 /v1，其余 API 根路径追加所选文字端点。" }
        if section == 1 { return "检查会发送固定短文字到上方地址，可能产生服务费用；不发送书内原文。阅读问答会发送问题、必要书内原文和所需对话。本地检索不代表问答全离线。" }
        return nil
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
        cell.textLabel?.numberOfLines = 0
        if indexPath.section == 0 {
            if indexPath.row == 1 {
                cell.textLabel?.text = "接口格式：" + draft.format.rawValue
                cell.accessoryType = .disclosureIndicator
                cell.accessibilityIdentifier = "ai-format"
            } else {
                let field = [0: name, 2: address, 3: model, 4: key][indexPath.row]!
                cell.contentView.addSubview(field)
                field.translatesAutoresizingMaskIntoConstraints = false
                NSLayoutConstraint.activate([
                    field.leadingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.leadingAnchor),
                    field.trailingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.trailingAnchor),
                    field.topAnchor.constraint(equalTo: cell.contentView.topAnchor, constant: 14),
                    field.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor, constant: -14)
                ])
                cell.selectionStyle = .none
            }
        } else if indexPath.section == 1 {
            cell.textLabel?.text = indexPath.row == 0 ? (checking ? "正在检查…" : "检查连接") : status
            cell.accessibilityIdentifier = indexPath.row == 0 ? "ai-check" : "ai-status"
            cell.selectionStyle = indexPath.row == 0 ? .default : .none
            if indexPath.row == 0 { cell.textLabel?.textColor = .systemBlue }
        } else {
            cell.textLabel?.text = indexPath.row == 0 ? "选择此配置" : "删除配置"
            cell.accessibilityIdentifier = indexPath.row == 0 ? "ai-select" : "ai-delete"
            cell.textLabel?.textColor = indexPath.row == 0 ? .systemBlue : .systemRed
        }
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard !checking else { return }
        view.endEditing(true)
        if indexPath.section == 0 && indexPath.row == 1 {
            let alert = UIAlertController(title: "接口格式", message: "仅支持非流式文字请求", preferredStyle: .actionSheet)
            for format in AIFormat.allCases {
                alert.addAction(UIAlertAction(title: format.rawValue, style: .default) { [weak self] _ in
                    self?.draft.format = format; self?.edited(); self?.tableView.reloadRows(at: [indexPath], with: .none)
                })
            }
            alert.addAction(UIAlertAction(title: "取消", style: .cancel)); present(alert, animated: true)
        } else if indexPath.section == 1 && indexPath.row == 0 { check() }
        else if indexPath.section == 2 && indexPath.row == 0 {
            let alert = UIAlertController(title: "使用已保存的此配置？", message: "此操作不保存当前修改，不改写或删除对话历史。", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "取消", style: .cancel))
            alert.addAction(UIAlertAction(title: "使用已保存配置", style: .default) { [weak self] _ in
                guard let self, let original = self.original else { return }
                do { try self.store.select(original.id); self.changed(); self.dismiss(animated: true) }
                catch { self.show(error) }
            }); present(alert, animated: true)
        } else if indexPath.section == 2 && indexPath.row == 1 {
            let alert = UIAlertController(title: "删除此配置？", message: "移除此服务配置，不改写或删除对话历史。", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "取消", style: .cancel))
            alert.addAction(UIAlertAction(title: "删除", style: .destructive) { [weak self] _ in
                guard let self else { return }
                do { try self.store.remove(self.draft.id); self.changed(); self.dismiss(animated: true) }
                catch { self.show(error) }
            }); present(alert, animated: true)
        }
    }
    private func configuration() -> AIConfiguration {
        var c = draft
        c.name = name.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        c.address = address.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        c.model = model.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return c
    }
    @objc private func edited() {
        status = "内容已修改，请重新检查；尚未保存。"
        tableView.reloadSections(IndexSet(integer: 1), with: .none)
    }
    @objc private func finishEditing() { view.endEditing(true) }
    @objc private func save() {
        do {
            try store.save(configuration(), newKey: key.text ?? "")
            key.text = ""; changed(); dismiss(animated: true)
        } catch { show(error) }
    }
    @objc private func cancel() { checkTask?.cancel(); key.text = ""; dismiss(animated: true) }
    private func check() {
        let c = configuration()
        do {
            let secret = (key.text?.isEmpty == false) ? key.text! : (try original.map { try store.key(for: $0) } ?? "")
            checking = true
            navigationItem.rightBarButtonItem?.isEnabled = false
            for field in [name, address, model, key] { field.isEnabled = false }
            tableView.reloadSections(IndexSet(integer: 1), with: .none)
            checkTask = Task { [weak self] in
                var result: String
                do { result = try await AIConnection().check(c, key: secret).statusDescription }
                catch { result = (error as? AIError ?? .network).localizedDescription }
                guard let self, !Task.isCancelled else { return }
                self.status = result; self.checking = false
                self.navigationItem.rightBarButtonItem?.isEnabled = true
                for field in [self.name, self.address, self.model, self.key] { field.isEnabled = true }
                self.tableView.reloadSections(IndexSet(integer: 1), with: .none)
            }
        } catch { show(error) }
    }
    private func show(_ error: Error) {
        let alert = UIAlertController(title: "操作未完成", message: (error as? AIError ?? .storage).localizedDescription, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "知道了", style: .default)); present(alert, animated: true)
    }
}
