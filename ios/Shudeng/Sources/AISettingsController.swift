import UIKit

final class AISettingsController: UITableViewController {
    private let root: URL
    private let secrets: AISecrets
    private var store: AIConfigurationStore?
    private var failure: String?

    init(root: URL, secrets: AISecrets = KeychainSecrets()) {
        self.root = root; self.secrets = secrets
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "AI 服务"
        BookDesign.table(tableView)
        tableView.accessibilityIdentifier = "ai-services"
        navigationItem.rightBarButtonItems = [
            UIBarButtonItem(title: "添加", style: .plain, target: self, action: #selector(add)),
            UIBarButtonItem(title: "切换", style: .plain, target: self, action: #selector(switchService))
        ]
        load()
    }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(false, animated: false)
    }
    private var configurations: [AIConfiguration] {
        guard let store else { return [] }
        // Keep the current service visible even with a long list of saved services.
        return store.configurations.filter { $0.id == store.selectedID } + store.configurations.filter { $0.id != store.selectedID }
    }
    private func load() {
        do { store = try AIConfigurationStore(root: root, secrets: secrets); failure = nil }
        catch { failure = "配置读取失败，已有内容未覆盖。点此重试；阅读仍可使用。" }
        navigationItem.rightBarButtonItems?.first?.isEnabled = store != nil
        navigationItem.rightBarButtonItems?.last?.isEnabled = !configurations.isEmpty
        tableView.reloadData()
    }
    override func numberOfSections(in tableView: UITableView) -> Int { 2 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        section == 0 ? max(configurations.count, 1) : 1
    }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        section == 0 ? "服务" : nil
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.numberOfLines = 0; cell.detailTextLabel?.numberOfLines = 0
        if indexPath.section == 1 {
            cell.textLabel?.text = "提问时问题与相关原文会发送到所选服务。详情"
            cell.textLabel?.font = .preferredFont(forTextStyle: .caption1)
            cell.textLabel?.adjustsFontForContentSizeCategory = true
            cell.textLabel?.textColor = .secondaryLabel
            cell.accessoryType = .disclosureIndicator
            cell.accessibilityIdentifier = "ai-send-details"
        } else if let store, !configurations.isEmpty {
            let configuration = configurations[indexPath.row]
            cell.textLabel?.text = configuration.name + (store.selectedID == configuration.id ? " · 使用中" : "")
            cell.detailTextLabel?.text = "模型：" + configuration.model + (store.hasSendConsent(for: configuration) ? "" : " · 待确认发送说明")
            cell.accessoryType = .disclosureIndicator
            cell.accessibilityIdentifier = "ai-config-" + configuration.id.uuidString
        } else {
            cell.textLabel?.text = failure ?? "尚未配置 AI 服务，仍可正常阅读。"
        }
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        if indexPath.section == 1 {
            navigationController?.pushViewController(AIPrivacyController(content: .sending), animated: true)
            return
        }
        guard store != nil else { load(); return }
        if !configurations.isEmpty { edit(configurations[indexPath.row]) }
    }
    @objc private func add() { edit(nil) }
    @objc private func switchService() {
        guard let store else { return }
        let choices = UIAlertController(title: "切换服务", message: nil, preferredStyle: .actionSheet)
        for configuration in configurations {
            let title = configuration.name + " · " + configuration.model
            choices.addAction(UIAlertAction(title: title, style: .default) { [weak self] _ in
                guard let self else { return }
                if store.hasSendConsent(for: configuration) {
                    do {
                        try store.select(configuration.id)
                        self.showResult("已切换服务")
                    } catch {
                        self.showSwitchFailure(error, configuration: configuration)
                    }
                    return
                }
                let notice = UIAlertController(title: "AI 服务发送说明", message: AIPrivacyController.sendNotice(for: configuration), preferredStyle: .alert)
                notice.addAction(UIAlertAction(title: "取消", style: .cancel))
                notice.addAction(UIAlertAction(title: "同意并使用已保存服务", style: .default) { [weak self] _ in
                    guard let self else { return }
                    do {
                        try store.select(configuration.id, confirmingSendConsent: true)
                        self.showResult("已切换服务")
                    } catch {
                        self.showSwitchFailure(error, configuration: configuration)
                    }
                })
                self.present(notice, animated: true)
            })
        }
        choices.addAction(UIAlertAction(title: "取消", style: .cancel))
        choices.popoverPresentationController?.barButtonItem = navigationItem.rightBarButtonItems?.last
        present(choices, animated: true)
    }
    private func showSwitchFailure(_ error: Error, configuration: AIConfiguration) {
        let failure = error as? AIError ?? .storage
        let alert = UIAlertController(title: "切换未完成", message: failure.localizedDescription, preferredStyle: .alert)
        if failure.offersKeyReplacement {
            alert.addAction(UIAlertAction(title: "重新填写 API Key", style: .default) { [weak self] _ in
                self?.edit(configuration)
            })
        }
        alert.addAction(UIAlertAction(title: "知道了", style: .cancel))
        present(alert, animated: true)
    }
    private func showResult(_ title: String, message: String? = nil) {
        load()
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "完成", style: .default))
        present(alert, animated: true)
    }
    private func edit(_ configuration: AIConfiguration?) {
        guard let store else { return }
        let editor = AIConfigurationController(store: store, configuration: configuration) { [weak self] message in
            guard let self else { return }
            self.showResult(message)
        }
        let nav = UINavigationController(rootViewController: editor)
        nav.isModalInPresentation = true
        present(nav, animated: true)
    }
}

final class AIConfigurationController: UITableViewController {
    private let store: AIConfigurationStore
    private let changed: (String) -> Void
    private let original: AIConfiguration?
    private var draft: AIConfiguration
    private let key = UITextField()
    private var checking = false
    private var status = "尚未检查连接。"
    private var checkFailure: AIError?
    private var savedKeyFailure: AIError?
    private var checkTask: Task<Void, Never>?

    init(store: AIConfigurationStore, configuration: AIConfiguration?, changed: @escaping (String) -> Void) {
        self.store = store; self.original = configuration; self.changed = changed
        draft = configuration ?? .deepSeek
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = original == nil ? "添加服务" : "编辑服务"
        BookDesign.table(tableView)
        tableView.accessibilityIdentifier = "ai-service-editor"
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "取消", style: .plain, target: self, action: #selector(cancel))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "保存", style: .done, target: self, action: #selector(save))
        tableView.keyboardDismissMode = .onDrag
        key.placeholder = original == nil ? "填写 API Key" : "留空保留已保存的密钥"
        key.accessibilityIdentifier = "ai-key"; key.accessibilityLabel = "API Key"
        key.font = .preferredFont(forTextStyle: .body); key.adjustsFontForContentSizeCategory = true
        key.autocorrectionType = .no; key.autocapitalizationType = .none
        key.isSecureTextEntry = true; key.textContentType = nil
        key.addTarget(self, action: #selector(edited), for: .editingChanged)
        key.addTarget(self, action: #selector(finishEditing), for: .editingDidEndOnExit)
        refreshSavedKeyStatus()
        if let savedKeyFailure { status = savedKeyFailure.localizedDescription; checkFailure = savedKeyFailure }
    }
    private func refreshSavedKeyStatus() {
        guard let original else { return }
        do { _ = try store.key(for: original); savedKeyFailure = nil }
        catch { savedKeyFailure = error as? AIError ?? .secret }
        key.placeholder = savedKeyFailure == nil ? "留空保留已保存的密钥" : "重新填写 API Key"
    }
    override func numberOfSections(in tableView: UITableView) -> Int { 4 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        switch section {
        case 0: return 3
        case 1: return 1
        case 2: return checkFailure?.offersKeyReplacement == true ? 3 : 2
        default: return original == nil ? 0 : 2
        }
    }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        if section == 0 {
            if original == nil { return "API Key 仅保存在设备 Keychain。" }
            switch savedKeyFailure {
            case .missingSecretReference: return "尚未保存 API Key，请重新填写。"
            case .secretMissing: return "API Key 已无法找到，请重新填写并保存。"
            case .secretLocked: return "API Key 暂时无法读取，请解锁设备后重试。"
            case .some: return "API Key 暂时无法读取，请重试或重新填写。"
            case .none: return "已保存 API Key；留空保留，填写新 Key 可替换。"
            }
        }
        if section == 2 { return "检查仅发送固定短文字，可能产生费用；不会保存配置。" }
        return nil
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.numberOfLines = 0; cell.detailTextLabel?.numberOfLines = 0
        if indexPath.section == 0 {
            switch indexPath.row {
            case 0:
                cell.textLabel?.text = "服务"; cell.detailTextLabel?.text = draft.name
                cell.accessoryType = .disclosureIndicator; cell.accessibilityIdentifier = "ai-provider"
            case 1: return aiFieldCell(label: "API Key", field: key)
            default:
                cell.textLabel?.text = "模型"
                cell.detailTextLabel?.text = draft.model.isEmpty ? "请在高级设置中填写" : draft.model
                cell.accessibilityIdentifier = "ai-model-summary"; cell.selectionStyle = .none
            }
        } else if indexPath.section == 1 {
            cell.textLabel?.text = "高级设置"; cell.accessoryType = .disclosureIndicator
            cell.accessibilityIdentifier = "ai-advanced"
        } else if indexPath.section == 2 {
            cell.textLabel?.text = indexPath.row == 0 ? (checking ? "正在检查…" : "检查连接") : indexPath.row == 1 ? status : "重新填写 API Key"
            cell.accessibilityIdentifier = indexPath.row == 0 ? "ai-check" : indexPath.row == 1 ? "ai-check-status" : "ai-replace-key"
            cell.selectionStyle = indexPath.row == 1 ? .none : .default
            if indexPath.row != 1 { cell.textLabel?.textColor = .systemBlue }
        } else {
            cell.textLabel?.text = indexPath.row == 0 ? "使用此服务" : "删除服务"
            cell.accessibilityIdentifier = indexPath.row == 0 ? "ai-select" : "ai-delete"
            cell.textLabel?.textColor = indexPath.row == 0 ? .systemBlue : .systemRed
        }
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard !checking else { return }
        view.endEditing(true)
        if indexPath.section == 0 && indexPath.row == 0 { chooseProvider() }
        else if indexPath.section == 1 {
            let advanced = AIAdvancedController(configuration: draft) { [weak self] configuration in
                guard let self else { return }
                self.draft = configuration; self.edited(); self.tableView.reloadData()
            }
            navigationController?.pushViewController(advanced, animated: true)
        } else if indexPath.section == 2 && indexPath.row == 0 { check() }
        else if indexPath.section == 2 && indexPath.row == 2 { replaceKey() }
        else if indexPath.section == 3 && indexPath.row == 0 { select() }
        else if indexPath.section == 3 && indexPath.row == 1 { remove() }
    }
    private func chooseProvider() {
        let alert = UIAlertController(title: "服务", message: nil, preferredStyle: .actionSheet)
        alert.addAction(UIAlertAction(title: "DeepSeek", style: .default) { [weak self] _ in
            guard let self else { return }
            let preset = AIConfiguration.deepSeek
            self.draft.name = preset.name; self.draft.address = preset.address
            self.draft.format = preset.format; self.draft.model = preset.model; self.draft.provider = preset.provider
            self.edited(); self.tableView.reloadData()
        })
        alert.addAction(UIAlertAction(title: "自定义服务", style: .default) { [weak self] _ in
            guard let self else { return }
            if self.draft.provider == .deepSeek {
                self.draft.name = "自定义服务"; self.draft.address = ""; self.draft.model = ""; self.draft.provider = .custom
            }
            self.draft.provider = .custom
            self.edited(); self.tableView.reloadData()
        })
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.popoverPresentationController?.sourceView = tableView.cellForRow(at: IndexPath(row: 0, section: 0)) ?? view
        present(alert, animated: true)
    }
    @objc private func edited() {
        status = "内容已修改；尚未保存，请重新检查连接。"; checkFailure = nil
        tableView.reloadSections(IndexSet(integer: 2), with: .none)
    }
    @objc private func finishEditing() { view.endEditing(true) }
    @objc private func save() {
        view.endEditing(true)
        do {
            try store.validateForSave(draft, newKey: key.text ?? "")
            confirmSending(draft, action: "同意并保存") { [weak self] in
                guard let self else { return }
                do {
                    try self.store.save(self.draft, newKey: self.key.text ?? "", confirmingSendConsent: true)
                    self.finish("已保存")
                } catch { self.show(error) }
            }
        } catch { show(error) }
    }
    private func select() {
        guard let original else { return }
        // Selecting uses the saved revision, never the unsaved draft or key.
        if store.hasSendConsent(for: original) {
            do {
                try store.select(original.id)
                finish("已切换服务")
            } catch { show(error) }
            return
        }
        confirmSending(original, action: "同意并使用已保存服务") { [weak self] in
            guard let self else { return }
            do {
                try self.store.select(original.id, confirmingSendConsent: true)
                self.finish("已切换服务")
            } catch { self.show(error) }
        }
    }
    private func confirmSending(_ configuration: AIConfiguration, action: String, confirmed: @escaping () -> Void) {
        if store.hasSendConsent(for: configuration) { confirmed(); return }
        let alert = UIAlertController(title: "AI 服务发送说明", message: AIPrivacyController.sendNotice(for: configuration), preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: action, style: .default) { _ in confirmed() })
        present(alert, animated: true)
    }
    private func remove() {
        let alert = UIAlertController(title: "删除此服务？", message: "不改写或删除对话历史。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: "删除", style: .destructive) { [weak self] _ in
            guard let self else { return }
            do { try self.store.remove(self.draft.id); self.finish("已删除服务") }
            catch { self.show(error) }
        })
        present(alert, animated: true)
    }
    private func finish(_ message: String) {
        key.text = ""
        dismiss(animated: true) { [changed] in changed(message) }
    }
    @objc private func cancel() { checkTask?.cancel(); key.text = ""; dismiss(animated: true) }
    private func replaceKey() {
        tableView.scrollToRow(at: IndexPath(row: 1, section: 0), at: .top, animated: false)
        key.becomeFirstResponder()
    }
    private func check() {
        let configuration = draft
        do {
            let secret = (key.text?.isEmpty == false) ? key.text! : (try original.map { try store.key(for: $0) } ?? "")
            if key.text?.isEmpty != false, original != nil {
                savedKeyFailure = nil; key.placeholder = "留空保留已保存的密钥"
            }
            checking = true; checkFailure = nil
            navigationItem.rightBarButtonItem?.isEnabled = false; key.isEnabled = false
            tableView.reloadSections(IndexSet([0, 2]), with: .none)
            checkTask = Task { [weak self] in
                let result: String
                var failure: AIError?
                do { result = try await AIConnection().check(configuration, key: secret).statusDescription }
                catch { failure = error as? AIError ?? .network; result = failure!.localizedDescription }
                guard let self, !Task.isCancelled else { return }
                self.status = result; self.checkFailure = failure; self.checking = false
                self.navigationItem.rightBarButtonItem?.isEnabled = true; self.key.isEnabled = true
                self.tableView.reloadSections(IndexSet(integer: 2), with: .none)
            }
        } catch {
            let failure = error as? AIError ?? .secret
            if key.text?.isEmpty != false, original != nil {
                savedKeyFailure = failure; key.placeholder = "重新填写 API Key"
            }
            status = failure.localizedDescription; checkFailure = failure
            tableView.reloadSections(IndexSet([0, 2]), with: .none)
            show(error)
        }
    }
    private func show(_ error: Error) {
        let failure = error as? AIError ?? .storage
        let alert = UIAlertController(title: "操作未完成", message: failure.localizedDescription, preferredStyle: .alert)
        if failure.offersKeyReplacement {
            alert.addAction(UIAlertAction(title: "重新填写 API Key", style: .default) { [weak self] _ in self?.replaceKey() })
        }
        alert.addAction(UIAlertAction(title: "知道了", style: .cancel))
        present(alert, animated: true)
    }
}

private func aiFieldCell(label: String, field: UITextField) -> UITableViewCell {
    let cell = UITableViewCell(style: .default, reuseIdentifier: nil)
    cell.selectionStyle = .none
    let title = UILabel()
    title.text = label; title.font = .preferredFont(forTextStyle: .subheadline)
    title.adjustsFontForContentSizeCategory = true; title.numberOfLines = 0
    title.accessibilityIdentifier = (field.accessibilityIdentifier ?? "ai-field") + "-label"
    let stack = UIStackView(arrangedSubviews: [title, field])
    stack.axis = .vertical; stack.spacing = 6; stack.translatesAutoresizingMaskIntoConstraints = false
    cell.contentView.addSubview(stack)
    NSLayoutConstraint.activate([
        stack.leadingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.leadingAnchor),
        stack.trailingAnchor.constraint(equalTo: cell.contentView.layoutMarginsGuide.trailingAnchor),
        stack.topAnchor.constraint(equalTo: cell.contentView.topAnchor, constant: 12),
        stack.bottomAnchor.constraint(equalTo: cell.contentView.bottomAnchor, constant: -12),
        field.heightAnchor.constraint(greaterThanOrEqualToConstant: 32)
    ])
    return cell
}

private final class AIAdvancedController: UITableViewController {
    private var draft: AIConfiguration
    private let changed: (AIConfiguration) -> Void
    private let name = UITextField(), address = UITextField(), model = UITextField()
    init(configuration: AIConfiguration, changed: @escaping (AIConfiguration) -> Void) {
        draft = configuration; self.changed = changed
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "高级设置"
        BookDesign.table(tableView)
        tableView.accessibilityIdentifier = "ai-advanced-editor"
        tableView.keyboardDismissMode = .onDrag
        for (field, label, value, id) in [
            (name, "服务名称", draft.name, "ai-name"),
            (address, "API 根地址或完整端点", draft.address, "ai-address"),
            (model, "自定义模型 ID", draft.model, "ai-model")
        ] {
            field.text = value; field.placeholder = label; field.accessibilityLabel = label; field.accessibilityIdentifier = id
            field.font = .preferredFont(forTextStyle: .body); field.adjustsFontForContentSizeCategory = true
            field.autocorrectionType = .no; field.autocapitalizationType = .none
            field.addTarget(self, action: #selector(edited), for: .editingChanged)
            field.addTarget(self, action: #selector(finishEditing), for: .editingDidEndOnExit)
        }
        address.keyboardType = .URL
    }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { 4 }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        "支持 OpenAI Chat Completions、Anthropic Messages 非流式文字接口。HTTPS 地址；本机测试可用 HTTP。地址中不要填写密钥。空路径使用 /v1，其余根路径追加文字端点。"
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        if indexPath.row < 3 {
            return aiFieldCell(label: ["服务名称", "地址", "自定义模型"][indexPath.row], field: [name, address, model][indexPath.row])
        }
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.text = "接口格式"; cell.detailTextLabel?.text = draft.format.rawValue
        cell.accessoryType = .disclosureIndicator; cell.accessibilityIdentifier = "ai-format"
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard indexPath.row == 3 else { return }
        view.endEditing(true)
        let alert = UIAlertController(title: "接口格式", message: "仅支持非流式文字请求", preferredStyle: .actionSheet)
        for format in AIFormat.allCases {
            alert.addAction(UIAlertAction(title: format.rawValue, style: .default) { [weak self] _ in
                guard let self else { return }
                self.draft.format = format; self.changed(self.draft); self.tableView.reloadRows(at: [indexPath], with: .none)
            })
        }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.popoverPresentationController?.sourceView = tableView.cellForRow(at: indexPath) ?? view
        present(alert, animated: true)
    }
    @objc private func edited() {
        draft.name = name.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        draft.address = address.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        draft.model = model.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        changed(draft)
    }
    @objc private func finishEditing() { view.endEditing(true) }
}
