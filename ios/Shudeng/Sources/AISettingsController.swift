import UIKit

final class AISettingsController: UITableViewController {
    /// 离线语义资料（按需下载）在设置页的状态机。
    private enum SemanticState {
        case notInstalled
        case downloading(progress: Double)
        case failed(SemanticFailure)
        case installed
        /// Debug 构建自带资料（Release 无 bundle 资源，不会出现）。
        case bundled
    }

    private enum SemanticFailure {
        case network, integrity, space, other

        var shortMessage: String {
            switch self {
            case .network: return "网络连接失败，点按重试"
            case .integrity: return "下载的资料不完整，点按重试"
            case .space: return "存储空间不足，点按重试"
            case .other: return "点按重试"
            }
        }

        var message: String {
            switch self {
            case .network: return "网络连接失败；请确认网络后重试。资料约 81MB，需要联网一次。"
            case .integrity: return "下载的资料不完整；请重试。"
            case .space: return "设备存储空间不足；请清理后重试。"
            case .other: return "资料下载未完成；请重试。"
            }
        }
    }

    private let root: URL
    private let secrets: AISecrets
    private let semanticStore: SemanticModelStore
    private var store: AIConfigurationStore?
    private var failure: String?
    private var semanticState: SemanticState = .notInstalled
    private var semanticDownload: Task<Void, Never>?
    private var semanticObserver: NSObjectProtocol?
    private var semanticGeneration = 0
    private var lastProgressAt = Date.distantPast
    private var lastProgressValue: Double = -1

    init(root: URL, secrets: AISecrets = KeychainSecrets(), semanticStore: SemanticModelStore = .shared) {
        self.root = root; self.secrets = secrets; self.semanticStore = semanticStore
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "AI 服务"
        BookDesign.formTable(tableView)
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "ai-value")
        tableView.accessibilityIdentifier = "ai-services"
        navigationItem.rightBarButtonItems = [
            UIBarButtonItem(title: "添加", style: .plain, target: self, action: #selector(add)),
            UIBarButtonItem(title: "切换", style: .plain, target: self, action: #selector(switchService))
        ]
        // 下载完成/移除后（含从其他入口触发）刷新本页状态；不打断进行中的下载。
        semanticObserver = NotificationCenter.default.addObserver(
            forName: SemanticModelStore.changed,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.refreshSemanticState()
                self.updateSemanticRow()
            }
        }
        refreshSemanticState()
        load()
    }

    deinit {
        if let semanticObserver { NotificationCenter.default.removeObserver(semanticObserver) }
    }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(false, animated: false)
        refreshSemanticState()
        updateSemanticRow()
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
    override func numberOfSections(in tableView: UITableView) -> Int { 3 }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        section == 0 ? max(configurations.count, 1) : 1
    }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        switch section {
        case 0: return "服务"
        case 1: return "离线语义资料"
        default: return nil
        }
    }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        switch section {
        case 0: return "API Key 仅保存在本机 Keychain；点按服务可编辑或检查连接。"
        case 1: return "用于书内 AI 语义检索；阅读、原文搜索、笔记不受影响。下载约 81MB，需联网一次。"
        default: return nil
        }
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "ai-value", for: indexPath)
        if indexPath.section == 1 {
            configureSemanticCell(cell)
        } else if indexPath.section == 2 {
            configureAICell(
                cell,
                title: "提问时问题与相关原文会发送到所选服务。详情",
                accessory: .disclosureIndicator,
                titleColour: BookDesign.ink2,
                titleFont: BookType.footnote
            )
            cell.accessibilityIdentifier = "ai-send-details"
        } else if let store, !configurations.isEmpty {
            let configuration = configurations[indexPath.row]
            let selected = store.selectedID == configuration.id
            configureAICell(
                cell,
                title: configuration.name,
                detail: "模型：" + configuration.model
                    + (selected ? " · 使用中" : "")
                    + (store.hasSendConsent(for: configuration) ? "" : " · 待确认发送说明"),
                accessory: selected ? .checkmark : .disclosureIndicator,
                titleColour: selected ? BookDesign.lampInk : BookDesign.ink,
                titleFont: BookType.sans(15, weight: selected ? .medium : .regular, style: .body)
            )
            cell.accessibilityIdentifier = "ai-config-" + configuration.id.uuidString
        } else {
            configureAICell(cell, title: failure ?? "尚未配置 AI 服务，仍可正常阅读。", titleColour: BookDesign.ink2)
            cell.accessibilityIdentifier = nil
        }
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        if indexPath.section == 1 {
            handleSemanticTap()
            return
        }
        if indexPath.section == 2 {
            navigationController?.pushViewController(AIPrivacyController(content: .sending), animated: true)
            return
        }
        guard store != nil else { load(); return }
        if !configurations.isEmpty { edit(configurations[indexPath.row]) }
    }

    // MARK: - 离线语义资料

    private func configureSemanticCell(_ cell: UITableViewCell) {
        var content = UIListContentConfiguration.subtitleCell()
        content.text = "离线语义资料"
        content.textProperties.font = BookType.body
        content.textProperties.color = BookDesign.ink
        content.textProperties.adjustsFontForContentSizeCategory = true

        let failed = isSemanticFailure
        content.secondaryText = semanticDetailText
        content.secondaryTextProperties.font = BookType.footnote
        content.secondaryTextProperties.color = failed ? BookDesign.error : BookDesign.ink3
        content.secondaryTextProperties.numberOfLines = 0
        content.secondaryTextProperties.adjustsFontForContentSizeCategory = true

        let symbol: String
        switch semanticState {
        case .installed, .bundled: symbol = "checkmark.circle.fill"
        case .downloading: symbol = "arrow.down.circle"
        case .failed: symbol = "exclamationmark.circle"
        case .notInstalled: symbol = "arrow.down.circle"
        }
        content.image = BookDesign.symbol(symbol, size: 18)
        content.imageProperties.tintColor = failed ? BookDesign.error : BookDesign.lampInk

        cell.contentConfiguration = content
        cell.backgroundColor = BookDesign.surface
        cell.accessoryType = .none
        cell.isAccessibilityElement = true
        cell.accessibilityIdentifier = "ai-semantic"
        cell.accessibilityLabel = "离线语义资料"
        cell.accessibilityValue = semanticAccessibilityValue
        cell.accessibilityHint = semanticAccessibilityHint
        cell.selectionStyle = .default
    }

    private var isSemanticFailure: Bool {
        if case .failed = semanticState { return true }
        return false
    }

    private var semanticDetailText: String {
        switch semanticState {
        case .installed: return "已下载 · 约 81MB"
        case .notInstalled: return "未下载 · 约 81MB"
        case .downloading(let progress): return "下载中 \(Int((progress * 100).rounded()))%"
        case .failed(let failure): return "下载失败 · " + failure.shortMessage
        case .bundled: return "可用 · 随 App 提供"
        }
    }

    private var semanticAccessibilityValue: String {
        switch semanticState {
        case .installed: return "已下载"
        case .notInstalled: return "未下载"
        case .downloading(let progress): return "下载中 \(Int((progress * 100).rounded()))%"
        case .failed: return "下载失败"
        case .bundled: return "可用"
        }
    }

    private var semanticAccessibilityHint: String {
        switch semanticState {
        case .notInstalled: return "轻点下载离线语义资料"
        case .downloading: return "轻点取消下载"
        case .installed: return "轻点删除离线语义资料"
        case .failed: return "轻点重新下载"
        case .bundled: return "随 App 提供，无需下载"
        }
    }

    private func updateSemanticRow() {
        let indexPath = IndexPath(row: 0, section: 1)
        guard tableView.numberOfSections > indexPath.section,
              tableView.numberOfRows(inSection: indexPath.section) > indexPath.row,
              let cell = tableView.cellForRow(at: indexPath) else { return }
        configureSemanticCell(cell)
    }

    private func refreshSemanticState(resetFailure: Bool = false) {
        guard semanticDownload == nil else { return }
        if semanticStore.isInstalled {
            semanticState = .installed
        } else if bundledSemanticAvailable {
            semanticState = .bundled
        } else if !resetFailure, isSemanticFailure {
            // 保留失败的分类提示，等待用户点按重试。
        } else {
            semanticState = .notInstalled
        }
    }

    private var bundledSemanticAvailable: Bool {
        Bundle.main.url(forResource: "SemanticModel", withExtension: nil) != nil
    }

    private func handleSemanticTap() {
        if case .downloading = semanticState {
            cancelSemanticDownload()
            return
        }
        switch semanticState {
        case .installed:
            confirmRemoveSemantic()
        case .bundled:
            let alert = BookAlertController(
                title: "离线语义资料可用",
                message: "当前 App 已随包提供离线语义资料，无需下载。",
                preferredStyle: .alert
            )
            alert.addAction(BookAlertAction(title: "知道了", style: .default))
            present(alert, animated: true)
        case .notInstalled, .failed:
            startSemanticDownload()
        case .downloading:
            break
        }
    }

    private func startSemanticDownload() {
        semanticGeneration += 1
        let generation = semanticGeneration
        semanticState = .downloading(progress: 0)
        lastProgressAt = .distantPast
        lastProgressValue = -1
        updateSemanticRow()
        semanticDownload = Task { [weak self] in
            guard let self else { return }
            do {
                try await self.semanticStore.download { [weak self] progress in
                    self?.receiveSemanticProgress(progress, generation: generation)
                }
                guard !Task.isCancelled, self.semanticGeneration == generation else { return }
                self.semanticDownload = nil
                if self.semanticStore.isInstalled {
                    self.semanticState = .installed
                    self.updateSemanticRow()
                    self.showSemanticDownloadedNotice()
                } else {
                    self.semanticState = .failed(.integrity)
                    self.updateSemanticRow()
                    self.showSemanticFailure(.integrity)
                }
            } catch {
                guard self.semanticGeneration == generation else { return }
                let cancelled = Task.isCancelled || (error as? URLError)?.code == .cancelled
                self.semanticDownload = nil
                if cancelled {
                    self.refreshSemanticState(resetFailure: true)
                    self.updateSemanticRow()
                } else {
                    let failure = Self.classifySemanticFailure(error)
                    self.semanticState = .failed(failure)
                    self.updateSemanticRow()
                    self.showSemanticFailure(failure)
                }
            }
        }
    }

    /// 进度节流：≥1% 或 ≥0.2s 才刷新一次行，避免整表 reload/抖动。
    private func receiveSemanticProgress(_ value: Double, generation: Int) {
        guard generation == semanticGeneration else { return }
        let progress = min(max(value, 0), 1)
        let now = Date()
        guard progress >= 1
                || progress - lastProgressValue >= 0.01
                || now.timeIntervalSince(lastProgressAt) >= 0.2 else { return }
        lastProgressValue = progress
        lastProgressAt = now
        guard case .downloading = semanticState else { return }
        semanticState = .downloading(progress: progress)
        updateSemanticRow()
    }

    private func cancelSemanticDownload() {
        semanticGeneration += 1
        semanticDownload?.cancel()
        semanticDownload = nil
        refreshSemanticState(resetFailure: true)
        updateSemanticRow()
    }

    private func confirmRemoveSemantic() {
        let alert = BookAlertController(
            title: "删除离线语义资料？",
            message: "删除后书内 AI 语义检索暂不可用；阅读、原文搜索和笔记不受影响。",
            preferredStyle: .alert
        )
        alert.addAction(BookAlertAction(title: "取消", style: .cancel))
        alert.addAction(BookAlertAction(title: "删除", style: .destructive) { [weak self] _ in
            guard let self else { return }
            do {
                try self.semanticStore.remove()
                self.refreshSemanticState(resetFailure: true)
                self.updateSemanticRow()
            } catch {
                let failure = BookAlertController(
                    title: "删除未完成",
                    message: "离线语义资料仍保留；请稍后重试。",
                    preferredStyle: .alert
                )
                failure.addAction(BookAlertAction(title: "知道了", style: .default))
                self.present(failure, animated: true)
            }
        })
        present(alert, animated: true)
    }

    private func showSemanticDownloadedNotice() {
        let alert = BookAlertController(
            title: "离线语义资料已下载",
            message: "语义资料会在后台准备；阅读、原文搜索和笔记不受影响。",
            preferredStyle: .alert
        )
        alert.addAction(BookAlertAction(title: "完成", style: .default))
        present(alert, animated: true)
    }

    private func showSemanticFailure(_ failure: SemanticFailure) {
        let alert = BookAlertController(
            title: "下载未完成",
            message: failure.message,
            preferredStyle: .alert
        )
        alert.addAction(BookAlertAction(title: "取消", style: .cancel))
        alert.addAction(BookAlertAction(title: "重试", style: .default) { [weak self] _ in
            self?.startSemanticDownload()
        })
        present(alert, animated: true)
    }

    private static func classifySemanticFailure(_ error: Error) -> SemanticFailure {
        if let downloadError = error as? SemanticModelDownloadError {
            if case .integrity = downloadError { return .integrity }
            return .network
        }
        if error is URLError { return .network }
        let nsError = error as NSError
        if nsError.domain == NSPOSIXErrorDomain, nsError.code == Int(POSIXErrorCode.ENOSPC.rawValue) {
            return .space
        }
        if nsError.domain == NSCocoaErrorDomain, nsError.code == NSFileWriteOutOfSpaceError {
            return .space
        }
        if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? NSError {
            return classifySemanticFailure(underlying)
        }
        return .other
    }
    @objc private func add() { edit(nil) }
    @objc private func switchService() {
        guard let store else { return }
        let choices = BookAlertController(title: "切换服务", message: nil, preferredStyle: .actionSheet)
        for configuration in configurations {
            let title = configuration.name + " · " + configuration.model
            choices.addAction(BookAlertAction(title: title, style: .default) { [weak self] _ in
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
                let notice = BookAlertController(title: "AI 服务发送说明", message: AIPrivacyController.sendNotice(for: configuration), preferredStyle: .alert)
                notice.addAction(BookAlertAction(title: "取消", style: .cancel))
                notice.addAction(BookAlertAction(title: "同意并使用已保存服务", style: .default) { [weak self] _ in
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
        choices.addAction(BookAlertAction(title: "取消", style: .cancel))
        choices.bookPopover.barButtonItem = navigationItem.rightBarButtonItems?.last
        present(choices, animated: true)
    }
    private func showSwitchFailure(_ error: Error, configuration: AIConfiguration) {
        let failure = error as? AIError ?? .storage
        let alert = BookAlertController(title: "切换未完成", message: failure.localizedDescription, preferredStyle: .alert)
        if failure.offersKeyReplacement {
            alert.addAction(BookAlertAction(title: "重新填写 API Key", style: .default) { [weak self] _ in
                self?.edit(configuration)
            })
        }
        alert.addAction(BookAlertAction(title: "知道了", style: .cancel))
        present(alert, animated: true)
    }
    private func showResult(_ title: String, message: String? = nil) {
        load()
        let alert = BookAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(BookAlertAction(title: "完成", style: .default))
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
        BookDesign.formTable(tableView)
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "ai-value")
        tableView.register(AIFieldCell.self, forCellReuseIdentifier: "ai-field")
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
    override func tableView(_ tableView: UITableView, willDisplayHeaderView view: UIView, forSection section: Int) {
        BookDesign.formHeaderFooter(view)
    }
    override func tableView(_ tableView: UITableView, willDisplayFooterView view: UIView, forSection section: Int) {
        BookDesign.formHeaderFooter(view)
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        if indexPath.section == 0 && indexPath.row == 1 {
            let cell = tableView.dequeueReusableCell(withIdentifier: "ai-field", for: indexPath) as! AIFieldCell
            cell.configure(label: "API Key", field: key)
            return cell
        }
        let cell = tableView.dequeueReusableCell(withIdentifier: "ai-value", for: indexPath)
        if indexPath.section == 0 {
            switch indexPath.row {
            case 0:
                configureAICell(cell, title: "服务", detail: draft.name, accessory: .disclosureIndicator)
                cell.accessibilityIdentifier = "ai-provider"
            default:
                configureAICell(cell, title: "模型", detail: draft.model.isEmpty ? "请在高级设置中填写" : draft.model)
                cell.accessibilityIdentifier = "ai-model-summary"; cell.selectionStyle = .none
            }
        } else if indexPath.section == 1 {
            configureAICell(cell, title: "高级设置", accessory: .disclosureIndicator)
            cell.accessibilityIdentifier = "ai-advanced"
        } else if indexPath.section == 2 {
            switch indexPath.row {
            case 0:
                configureAICell(cell, title: checking ? "正在检查…" : "检查连接", titleColour: BookDesign.lampInk)
                cell.accessibilityIdentifier = "ai-check"
            case 1:
                configureAICell(cell, title: status, titleColour: BookDesign.ink2, titleFont: BookType.footnote)
                cell.accessibilityIdentifier = "ai-check-status"; cell.selectionStyle = .none
            default:
                configureAICell(cell, title: "重新填写 API Key", titleColour: BookDesign.lampInk)
                cell.accessibilityIdentifier = "ai-replace-key"
            }
        } else {
            if indexPath.row == 0 {
                configureAICell(cell, title: "使用此服务", titleColour: BookDesign.lampInk)
                cell.accessibilityIdentifier = "ai-select"
            } else {
                configureAICell(cell, title: "删除服务", titleColour: BookDesign.error)
                cell.accessibilityIdentifier = "ai-delete"
            }
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
        let alert = BookAlertController(title: "服务", message: nil, preferredStyle: .actionSheet)
        alert.addAction(BookAlertAction(title: "DeepSeek", style: .default) { [weak self] _ in
            guard let self else { return }
            let preset = AIConfiguration.deepSeek
            self.draft.name = preset.name; self.draft.address = preset.address
            self.draft.format = preset.format; self.draft.model = preset.model; self.draft.provider = preset.provider
            self.edited(); self.tableView.reloadData()
        })
        alert.addAction(BookAlertAction(title: "自定义服务", style: .default) { [weak self] _ in
            guard let self else { return }
            if self.draft.provider == .deepSeek {
                self.draft.name = "自定义服务"; self.draft.address = ""; self.draft.model = ""; self.draft.provider = .custom
            }
            self.draft.provider = .custom
            self.edited(); self.tableView.reloadData()
        })
        alert.addAction(BookAlertAction(title: "取消", style: .cancel))
        alert.bookPopover.sourceView = tableView.cellForRow(at: IndexPath(row: 0, section: 0)) ?? view
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
        let alert = BookAlertController(title: "AI 服务发送说明", message: AIPrivacyController.sendNotice(for: configuration), preferredStyle: .alert)
        alert.addAction(BookAlertAction(title: "取消", style: .cancel))
        alert.addAction(BookAlertAction(title: action, style: .default) { _ in confirmed() })
        present(alert, animated: true)
    }
    private func remove() {
        let alert = BookAlertController(title: "删除此服务？", message: "不改写或删除对话历史。", preferredStyle: .alert)
        alert.addAction(BookAlertAction(title: "取消", style: .cancel))
        alert.addAction(BookAlertAction(title: "删除", style: .destructive) { [weak self] _ in
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
        let alert = BookAlertController(title: "操作未完成", message: failure.localizedDescription, preferredStyle: .alert)
        if failure.offersKeyReplacement {
            alert.addAction(BookAlertAction(title: "重新填写 API Key", style: .default) { [weak self] _ in self?.replaceKey() })
        }
        alert.addAction(BookAlertAction(title: "知道了", style: .cancel))
        present(alert, animated: true)
    }
}

/// 纸墨表单文本行：系统 UIListContentConfiguration 承载标题/副标题，保留原有标识符与配色。
private func configureAICell(
    _ cell: UITableViewCell,
    title: String,
    detail: String? = nil,
    accessory: UITableViewCell.AccessoryType = .none,
    titleColour: UIColor = BookDesign.ink,
    titleFont: UIFont = BookType.body
) {
    var content = detail == nil ? UIListContentConfiguration.cell() : UIListContentConfiguration.subtitleCell()
    content.text = title
    content.textProperties.font = titleFont
    content.textProperties.color = titleColour
    content.textProperties.numberOfLines = 0
    content.textProperties.adjustsFontForContentSizeCategory = true
    if let detail {
        content.secondaryText = detail
        content.secondaryTextProperties.font = BookType.footnote
        content.secondaryTextProperties.color = BookDesign.ink3
        content.secondaryTextProperties.numberOfLines = 0
        content.secondaryTextProperties.adjustsFontForContentSizeCategory = true
    }
    cell.contentConfiguration = content
    cell.backgroundColor = BookDesign.surface
    cell.accessoryType = accessory
    // 复用自“离线语义资料”行时清理该行设置的无障碍信息，避免串到服务行。
    cell.isAccessibilityElement = true
    cell.accessibilityLabel = nil
    cell.accessibilityValue = nil
    cell.accessibilityHint = nil
    cell.tintColor = accessory == .checkmark ? BookDesign.lamp : BookDesign.ink3
    cell.selectionStyle = .default
}

/// 内嵌 UITextField 的表单行（API Key / 高级设置）。输入框由控制器持有，复用时移动进当前 cell。
private final class AIFieldCell: UITableViewCell {
    private let title = UILabel()
    private let stack = UIStackView()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = BookDesign.surface
        selectionStyle = .none
        title.font = BookType.subhead
        title.textColor = BookDesign.ink2
        title.adjustsFontForContentSizeCategory = true
        title.numberOfLines = 0
        stack.axis = .vertical
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.addArrangedSubview(title)
        contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.trailingAnchor),
            stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 12),
            stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -12)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func configure(label: String, field: UITextField) {
        title.text = label
        title.accessibilityIdentifier = (field.accessibilityIdentifier ?? "ai-field") + "-label"
        guard field.superview !== stack else { return }
        for view in stack.arrangedSubviews where view !== title && view !== field {
            view.removeFromSuperview()
        }
        field.textColor = BookDesign.ink
        field.backgroundColor = BookDesign.paperDeep
        field.layer.cornerRadius = BookRadius.field
        field.borderStyle = .none
        field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 10, height: 1))
        field.leftViewMode = .always
        field.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 10, height: 1))
        field.rightViewMode = .always
        stack.addArrangedSubview(field)
        field.heightAnchor.constraint(greaterThanOrEqualToConstant: 32).isActive = true
    }
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
        BookDesign.formTable(tableView)
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "ai-value")
        tableView.register(AIFieldCell.self, forCellReuseIdentifier: "ai-field")
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
            let cell = tableView.dequeueReusableCell(withIdentifier: "ai-field", for: indexPath) as! AIFieldCell
            cell.configure(
                label: ["服务名称", "地址", "自定义模型"][indexPath.row],
                field: [name, address, model][indexPath.row]
            )
            return cell
        }
        let cell = tableView.dequeueReusableCell(withIdentifier: "ai-value", for: indexPath)
        configureAICell(cell, title: "接口格式", detail: draft.format.rawValue, accessory: .disclosureIndicator)
        cell.accessibilityIdentifier = "ai-format"
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard indexPath.row == 3 else { return }
        view.endEditing(true)
        let alert = BookAlertController(title: "接口格式", message: "仅支持非流式文字请求", preferredStyle: .actionSheet)
        for format in AIFormat.allCases {
            alert.addAction(BookAlertAction(title: format.rawValue, style: .default) { [weak self] _ in
                guard let self else { return }
                self.draft.format = format; self.changed(self.draft); self.tableView.reloadRows(at: [indexPath], with: .none)
            })
        }
        alert.addAction(BookAlertAction(title: "取消", style: .cancel))
        alert.bookPopover.sourceView = tableView.cellForRow(at: indexPath) ?? view
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
