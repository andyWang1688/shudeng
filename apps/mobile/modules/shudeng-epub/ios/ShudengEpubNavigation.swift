import ExpoModulesCore
import UIKit

private struct EpubNavigationRow: Decodable {
  let id: String
  let title: String
  let detail: String?
  let excerpt: String?
  let depth: Int?
  let selectionKey: String?
}
private struct EpubNavigationState: Decodable {
  let tab: String
  let contents: [EpubNavigationRow]
  let contentsStatus: String
  let bookmarks: [EpubNavigationRow]
  let bookmarkSaving: Bool
  let feedback: String?
  let searchOpen: Bool
  let query: String
  let results: [EpubNavigationRow]
  let searchBusy: Bool
  let searchError: String?
  let preparationMessage: String
  let preparationFailed: Bool
  let canPrepare: Bool
}

/// Immutable data and action intents cross this port; indexing/storage stay in TypeScript.
final class ShudengEpubNavigationView: ExpoView, UIAdaptivePresentationControllerDelegate {
  let onNavigationAction = EventDispatcher()
  private var state: EpubNavigationState?
  private var wantsVisible = false
  private var dark = false
  private var navigation: UINavigationController?
  private var controller: EpubNavigationController?
  private var scheduled = false
  private var dismissing = false
  private var presentationID: UUID?
  private var selectedSearchResult: (id: String, key: String)?

  func setVisible(_ value: Bool) { wantsVisible = value; schedule() }
  func setDark(_ value: Bool) { dark = value; navigation?.overrideUserInterfaceStyle = value ? .dark : .light }
  func setState(_ json: String) {
    guard let bytes = json.data(using: .utf8), let state = try? JSONDecoder().decode(EpubNavigationState.self, from: bytes) else { return }
    self.state = state
    controller?.update(state)
    schedule()
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { dismiss(animated: false) } else { schedule() }
  }
  private func schedule() {
    guard !scheduled else { return }; scheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }; self.scheduled = false; self.reconcile()
    }
  }
  private func reconcile() {
    guard wantsVisible, window != nil else { dismiss(animated: window != nil); return }
    guard navigation == nil, !dismissing, let state, let presenter = presentingController(), presenter.viewIfLoaded?.window != nil else { return }
    let presentationID = UUID()
    self.presentationID = presentationID
    selectedSearchResult = nil
    let controller = EpubNavigationController(state: state) { [weak self] action in self?.handle(action, presentationID: presentationID) }
    let navigation = UINavigationController(rootViewController: controller)
    navigation.modalPresentationStyle = .automatic
    navigation.sheetPresentationController?.detents = [.large()]
    navigation.overrideUserInterfaceStyle = dark ? .dark : .light
    navigation.view.tintColor = EpubNavigationStyle.lamp
    EpubNavigationStyle.navigation(navigation.navigationBar)
    self.controller = controller; self.navigation = navigation
    navigation.presentationController?.delegate = self
    presenter.present(navigation, animated: true)
  }
  private func handle(_ action: [String: Any], presentationID: UUID) {
    guard self.presentationID == presentationID, navigation != nil, wantsVisible, !dismissing else { return }
    let kind = action["action"] as? String
    if kind == "selectSearchResult" {
      guard selectedSearchResult == nil, let id = action["id"] as? String, let key = action["selectionKey"] as? String,
        !key.isEmpty, state?.results.filter({ $0.id == id && $0.selectionKey == key }).count == 1 else { return }
      selectedSearchResult = (id, key)
      onNavigationAction(action)
    } else if kind == "navigate" {
      if action["source"] as? String == "search" {
        guard let selected = selectedSearchResult, selected.id == action["id"] as? String, selected.key == action["selectionKey"] as? String else { return }
      }
      wantsVisible = false
      dismiss(animated: true) { [weak self] in self?.onNavigationAction(action) }
    } else { onNavigationAction(action) }
  }
  private func presentingController() -> UIViewController? {
    var responder: UIResponder? = next
    while let current = responder {
      if var presenter = current as? UIViewController {
        while let presented = presenter.presentedViewController {
          guard !presented.isBeingDismissed else { return nil }; presenter = presented
        }
        return presenter
      }
      responder = current.next
    }
    return nil
  }
  private func dismiss(animated: Bool, completion: (() -> Void)? = nil) {
    guard let navigation, !dismissing else { return }
    dismissing = true
    let presentationID = self.presentationID
    navigation.dismiss(animated: animated) { [weak self, weak navigation] in
      guard let self, self.navigation === navigation, self.presentationID == presentationID else { return }
      self.navigation = nil; self.controller = nil; self.dismissing = false
      self.presentationID = nil; self.selectedSearchResult = nil
      completion?(); self.schedule()
    }
  }
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    // A programmatic dismissal is completed by its own callback exactly once.
    guard !dismissing, presentationController.presentedViewController === navigation else { return }
    navigation = nil; controller = nil; wantsVisible = false
    presentationID = nil; selectedSearchResult = nil
    onNavigationAction(["action": "close"])
  }
}

private final class EpubNavigationController: UITableViewController, UINavigationControllerDelegate {
  private var state: EpubNavigationState
  private let emit: ([String: Any]) -> Void
  private let tabs = UISegmentedControl(items: ["目录", "书签"])
  private var search: EpubSearchController?
  private var settingStack = false
  private var searchDismissed = false
  init(state: EpubNavigationState, emit: @escaping ([String: Any]) -> Void) {
    self.state = state; self.emit = emit; super.init(style: .insetGrouped)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
  override func viewDidLoad() {
    super.viewDidLoad()
    EpubNavigationStyle.table(tableView)
    tableView.accessibilityIdentifier = "book-navigation"
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "navigation-row")
    tabs.selectedSegmentIndex = state.tab == "bookmarks" ? 1 : 0
    tabs.addTarget(self, action: #selector(tabChanged), for: .valueChanged)
    navigationItem.titleView = tabs
    navigationItem.leftBarButtonItem = UIBarButtonItem(title: "完成", style: .done, target: self, action: #selector(done))
    navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .add, target: self, action: #selector(addBookmark))
    navigationItem.rightBarButtonItem?.accessibilityLabel = "添加书签"
    toolbarItems = [UIBarButtonItem(title: "书内搜索", style: .plain, target: self, action: #selector(openSearch))]
    navigationController?.delegate = self
    refresh()
  }
  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated); navigationController?.setToolbarHidden(false, animated: false)
  }
  func update(_ value: EpubNavigationState) { state = value; if !value.searchOpen { searchDismissed = false }; if isViewLoaded { refresh() }; search?.update(value) }
  private var isContents: Bool { state.tab != "bookmarks" }
  private var rows: [EpubNavigationRow] { isContents ? state.contents : state.bookmarks }
  private func refresh() {
    tabs.selectedSegmentIndex = isContents ? 0 : 1
    navigationItem.rightBarButtonItem?.isEnabled = !state.bookmarkSaving
    tableView.reloadData(); updateEmptyState()
    guard let navigationController else { return }
    if state.searchOpen && search == nil && !searchDismissed {
      let search = EpubSearchController(state: state, emit: emit)
      self.search = search; settingStack = true
      navigationController.pushViewController(search, animated: true)
      settingStack = false
    } else if !state.searchOpen && search != nil {
      settingStack = true; navigationController.popToViewController(self, animated: true); search = nil; settingStack = false
    }
  }
  func navigationController(_ navigationController: UINavigationController, didShow viewController: UIViewController, animated: Bool) {
    if viewController === self, search != nil, !settingStack { search = nil; searchDismissed = true; emit(["action": "searchClose"]) }
  }
  @objc private func done() { emit(["action": "close"]) }
  @objc private func tabChanged() { emit(["action": "tab", "tab": tabs.selectedSegmentIndex == 0 ? "contents" : "bookmarks"]) }
  @objc private func openSearch() { emit(["action": "searchOpen"]) }
  @objc private func addBookmark() { emit(["action": "addBookmark"]) }
  override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { max(1, rows.count) }
  override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? { state.feedback }
  override func tableView(_ tableView: UITableView, willDisplayFooterView view: UIView, forSection section: Int) { EpubNavigationStyle.headerFooter(view) }
  override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "navigation-row", for: indexPath)
    cell.accessoryType = .none; cell.selectionStyle = .default; cell.accessibilityIdentifier = nil; cell.accessibilityValue = nil
    cell.backgroundColor = EpubNavigationStyle.paper
    guard rows.indices.contains(indexPath.row) else {
      var content = UIListContentConfiguration.cell()
      content.text = isContents ? state.contentsStatus : "暂无书签"
      content.textProperties.font = EpubNavigationStyle.footnote; content.textProperties.color = EpubNavigationStyle.ink3; content.textProperties.numberOfLines = 0
      cell.contentConfiguration = content; cell.selectionStyle = .none; return cell
    }
    let row = rows[indexPath.row]
    var content = isContents ? UIListContentConfiguration.cell() : UIListContentConfiguration.subtitleCell()
    content.text = row.title; content.textProperties.font = EpubNavigationStyle.body; content.textProperties.color = EpubNavigationStyle.ink
    content.textProperties.numberOfLines = isContents ? 0 : 1
    if isContents {
      content.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 10, leading: 20 + CGFloat(min(4, max(0, row.depth ?? 0))) * 16, bottom: 10, trailing: 20)
    } else {
      content.image = UIImage(systemName: "bookmark.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 13, weight: .medium))
      content.imageProperties.tintColor = EpubNavigationStyle.lamp
      content.secondaryText = row.detail; content.secondaryTextProperties.font = EpubNavigationStyle.footnote; content.secondaryTextProperties.color = EpubNavigationStyle.ink3; content.secondaryTextProperties.numberOfLines = 1
      cell.accessibilityIdentifier = "bookmark-" + row.id; cell.accessibilityValue = row.excerpt
    }
    cell.contentConfiguration = content; cell.accessoryType = .disclosureIndicator
    return cell
  }
  override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    guard rows.indices.contains(indexPath.row) else { return }
    emit(["action": "navigate", "source": isContents ? "contents" : "bookmarks", "id": rows[indexPath.row].id])
  }
  override func tableView(_ tableView: UITableView, canEditRowAt indexPath: IndexPath) -> Bool { !isContents && rows.indices.contains(indexPath.row) }
  override func tableView(_ tableView: UITableView, titleForDeleteConfirmationButtonForRowAt indexPath: IndexPath) -> String? { "移除" }
  override func tableView(_ tableView: UITableView, commit editingStyle: UITableViewCell.EditingStyle, forRowAt indexPath: IndexPath) {
    guard !isContents, rows.indices.contains(indexPath.row) else { return }
    emit(["action": "deleteBookmark", "id": rows[indexPath.row].id])
  }
  private func updateEmptyState() {
    guard #available(iOS 17.0, *) else { return }
    guard rows.isEmpty else { contentUnavailableConfiguration = nil; return }
    if isContents {
      if state.contentsStatus == "正在读取目录…" { contentUnavailableConfiguration = nil }
      else if state.contentsStatus.hasPrefix("目录读取失败") {
        contentUnavailableConfiguration = EpubNavigationStyle.empty(title: "目录读取失败", detail: "请关闭后重试；仍可阅读正文。", symbol: "exclamationmark.triangle", actionTitle: "关闭") { [weak self] in self?.done() }
      } else {
        contentUnavailableConfiguration = EpubNavigationStyle.empty(title: state.contentsStatus, detail: "可用书内搜索定位原文。", symbol: "list.bullet", actionTitle: "搜索原文") { [weak self] in self?.openSearch() }
      }
    } else {
      contentUnavailableConfiguration = EpubNavigationStyle.empty(title: "暂无书签", detail: "轻点右上角 + 保存当前位置，书签会留在本书里。", symbol: "bookmark", actionTitle: "保存当前位置") { [weak self] in self?.addBookmark() }
    }
  }
}

private final class EpubSearchController: UITableViewController, UISearchResultsUpdating {
  private var state: EpubNavigationState
  private var selectionSubmitted = false
  private let emit: ([String: Any]) -> Void
  private let searchController = UISearchController(searchResultsController: nil)
  init(state: EpubNavigationState, emit: @escaping ([String: Any]) -> Void) { self.state = state; self.emit = emit; super.init(style: .insetGrouped) }
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
  override func viewDidLoad() {
    super.viewDidLoad(); title = "书内搜索"
    EpubNavigationStyle.table(tableView)
    tableView.accessibilityIdentifier = "book-search-results"; tableView.keyboardDismissMode = .onDrag
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: "search-hit")
    searchController.obscuresBackgroundDuringPresentation = false
    searchController.hidesNavigationBarDuringPresentation = false
    searchController.searchResultsUpdater = self
    searchController.searchBar.placeholder = "当前书关键词"
    searchController.searchBar.accessibilityIdentifier = "book-search-query"
    searchController.searchBar.searchTextField.accessibilityIdentifier = "book-search-query"
    searchController.searchBar.text = state.query
    navigationItem.searchController = searchController; navigationItem.hidesSearchBarWhenScrolling = false
    definesPresentationContext = true; refresh()
  }
  override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); navigationController?.setToolbarHidden(true, animated: false) }
  func update(_ value: EpubNavigationState) { state = value; if isViewLoaded { refresh() } }
  private func refresh() {
    navigationItem.rightBarButtonItem = UIBarButtonItem(title: state.preparationFailed ? "重试准备" : "重新准备", style: .plain, target: self, action: #selector(prepareBook))
    navigationItem.rightBarButtonItem?.isEnabled = state.canPrepare
    tableView.reloadData(); updateEmptyState()
  }
  @objc private func prepareBook() { emit(["action": "prepare"]) }
  private func clearSearch() { searchController.searchBar.text = ""; emit(["action": "query", "query": ""]) }
  func updateSearchResults(for searchController: UISearchController) {
    let query = searchController.searchBar.text ?? ""
    if query != state.query { emit(["action": "query", "query": query]) }
  }
  override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { state.results.count }
  override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { state.preparationMessage }
  override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
    if state.results.isEmpty && !state.query.isEmpty { return nil }
    return state.query.isEmpty ? "输入中英关键词，仅搜索当前书原文" : "找到\(state.results.count)处原文"
  }
  override func tableView(_ tableView: UITableView, willDisplayHeaderView view: UIView, forSection section: Int) { EpubNavigationStyle.headerFooter(view) }
  override func tableView(_ tableView: UITableView, willDisplayFooterView view: UIView, forSection section: Int) { EpubNavigationStyle.headerFooter(view) }
  override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let row = state.results[indexPath.row]
    let cell = tableView.dequeueReusableCell(withIdentifier: "search-hit", for: indexPath); cell.backgroundColor = EpubNavigationStyle.paper
    var content = UIListContentConfiguration.subtitleCell()
    content.text = row.title; content.textProperties.font = EpubNavigationStyle.body; content.textProperties.color = EpubNavigationStyle.ink; content.textProperties.numberOfLines = 0
    content.secondaryText = row.detail; content.secondaryTextProperties.font = EpubNavigationStyle.footnote; content.secondaryTextProperties.color = EpubNavigationStyle.ink2; content.secondaryTextProperties.numberOfLines = 0
    cell.contentConfiguration = content; cell.accessoryType = .disclosureIndicator; cell.accessibilityIdentifier = "search-hit-" + row.id
    return cell
  }
  override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    guard !selectionSubmitted, searchController.searchBar.text == state.query, state.results.indices.contains(indexPath.row) else { return }
    let selected = state.results[indexPath.row]
    guard let selectionKey = selected.selectionKey, !selectionKey.isEmpty else { return }
    selectionSubmitted = true
    // Capture selection before deactivation can enqueue search cleanup actions.
    emit(["action": "selectSearchResult", "id": selected.id, "selectionKey": selectionKey])
    searchController.isActive = false
    emit(["action": "navigate", "source": "search", "id": selected.id, "selectionKey": selectionKey])
  }
  private func updateEmptyState() {
    guard #available(iOS 17.0, *) else { return }
    guard !state.query.isEmpty, state.results.isEmpty, !state.searchBusy else { contentUnavailableConfiguration = nil; return }
    contentUnavailableConfiguration = EpubNavigationStyle.empty(title: state.searchError == nil ? "已准备原文中没有匹配结果" : "资料暂时无法搜索", detail: state.preparationMessage, symbol: state.searchError == nil ? "magnifyingglass" : "exclamationmark.triangle", actionTitle: "清空搜索") { [weak self] in self?.clearSearch() }
  }
}

private enum EpubNavigationStyle {
  static let paper = color(0xFAF7F1, 0x1B1A17), ink = color(0x211E18, 0xF3EEE3), ink2 = color(0x57534A, 0xC3BCAE), ink3 = color(0x6E6A60, 0x948D80), line = color(0xE7E0D2, 0x3A362F), lamp = color(0xB4712A, 0xE0AE6A)
  static let body = font(15, style: .body), footnote = font(12, style: .footnote), caption = font(10.5, weight: .medium, style: .caption1)
  private static func color(_ light: Int, _ dark: Int) -> UIColor { UIColor { traits in let value = traits.userInterfaceStyle == .dark ? dark : light; return UIColor(red: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1) } }
  private static func font(_ size: CGFloat, weight: UIFont.Weight = .regular, style: UIFont.TextStyle) -> UIFont { UIFontMetrics(forTextStyle: style).scaledFont(for: .systemFont(ofSize: size, weight: weight)) }
  private static func serif(_ size: CGFloat, style: UIFont.TextStyle) -> UIFont { UIFontMetrics(forTextStyle: style).scaledFont(for: UIFont(name: "SongtiSC-Bold", size: size) ?? .systemFont(ofSize: size, weight: .semibold)) }
  static func table(_ table: UITableView) {
    table.backgroundColor = paper; table.separatorColor = line; table.separatorInset = UIEdgeInsets(top: 0, left: 20, bottom: 0, right: 20)
    table.rowHeight = UITableView.automaticDimension; table.estimatedRowHeight = 56; table.sectionHeaderTopPadding = 20; table.contentInset = UIEdgeInsets(top: 0, left: 0, bottom: 24, right: 0)
  }
  static func headerFooter(_ view: UIView) { guard let view = view as? UITableViewHeaderFooterView else { return }; view.contentView.backgroundColor = paper; view.textLabel?.font = caption; view.textLabel?.textColor = ink3; view.textLabel?.numberOfLines = 0 }
  static func navigation(_ bar: UINavigationBar) {
    let standard = UINavigationBarAppearance(); standard.configureWithOpaqueBackground(); standard.backgroundColor = paper; standard.shadowColor = .clear
    standard.titleTextAttributes = [.foregroundColor: ink, .font: serif(17, style: .headline)]; standard.largeTitleTextAttributes = [.foregroundColor: ink, .font: serif(30, style: .largeTitle)]
    bar.standardAppearance = standard; bar.compactAppearance = standard
    if #available(iOS 26.0, *) { let edge = UINavigationBarAppearance(); edge.configureWithTransparentBackground(); edge.titleTextAttributes = standard.titleTextAttributes; edge.largeTitleTextAttributes = standard.largeTitleTextAttributes; bar.scrollEdgeAppearance = edge; bar.compactScrollEdgeAppearance = edge } else { bar.scrollEdgeAppearance = standard }
  }
  @available(iOS 17.0, *) static func empty(title: String, detail: String, symbol: String, actionTitle: String, action: @escaping () -> Void) -> UIContentUnavailableConfiguration {
    var configuration = UIContentUnavailableConfiguration.empty()
    configuration.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 44, weight: .light)); configuration.imageProperties.tintColor = ink2
    configuration.text = title; configuration.textProperties.font = serif(24, style: .title2); configuration.textProperties.color = ink
    configuration.secondaryText = detail; configuration.secondaryTextProperties.font = font(13, weight: .medium, style: .subheadline); configuration.secondaryTextProperties.color = ink2
    var button = configuration.button; button.title = actionTitle; button.baseForegroundColor = paper; button.baseBackgroundColor = ink; button.cornerStyle = .capsule; button.contentInsets = NSDirectionalEdgeInsets(top: 11, leading: 22, bottom: 11, trailing: 22)
    configuration.button = button; configuration.buttonProperties.primaryAction = UIAction { _ in action() }; return configuration
  }
}
