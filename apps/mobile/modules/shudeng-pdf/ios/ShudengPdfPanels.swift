import ExpoModulesCore
import UIKit

private struct PdfPanelRow: Decodable {
  let id: String
  let title: String
  let detail: String?
  let depth: Int
  let deletable: Bool
  let bookmark: Bool
}

private struct PdfPanelState: Decodable {
  let kind: String
  let tab: String
  let query: String
  let queryEventCount: Int
  let status: String
  let flow: String
  let searchEnabled: Bool
  let rows: [PdfPanelRow]
}

/// A UIKit navigation container and controls, fed with immutable presentation data from RN.
/// No book, database, file or conversation operations are performed here.
public final class ShudengPdfPanelView: ExpoView {
  let onPanelAction = EventDispatcher()
  private var navigation: UINavigationController?
  private var settings: PdfSettingsController?
  private var contents: PdfContentsController?
  private var kind = ""
  private var dark = false
  private var lastState = ""

  func setDark(_ value: Bool) {
    dark = value
    overrideUserInterfaceStyle = value ? .dark : .light
    navigation?.overrideUserInterfaceStyle = overrideUserInterfaceStyle
  }

  func setState(_ json: String) {
    guard json != lastState, let data = json.data(using: .utf8),
          let state = try? JSONDecoder().decode(PdfPanelState.self, from: data) else { return }
    lastState = json
    if kind != state.kind || navigation == nil { install(kind: state.kind) }
    settings?.setFlow(state.flow)
    contents?.setState(state)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    navigation?.view.frame = bounds
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { detach() } else { attach() }
  }

  private func install(kind: String) {
    detach()
    navigation?.view.removeFromSuperview()
    self.kind = kind
    let action: ([String: Any]) -> Void = { [weak self] payload in self?.onPanelAction(payload) }
    let controller: UIViewController
    if kind == "settings" {
      let settings = PdfSettingsController(action: action)
      self.settings = settings
      contents = nil
      controller = settings
    } else {
      let contents = PdfContentsController(action: action)
      self.contents = contents
      settings = nil
      controller = contents
    }
    let navigation = PdfPanelNavigationController(rootViewController: controller)
    navigation.overrideUserInterfaceStyle = dark ? .dark : .light
    navigation.view.backgroundColor = PdfAppearance.paper
    navigation.view.tintColor = PdfAppearance.lamp
    // The root view may load before it has a navigationController. Configure
    // the actual bar here, after the container and its appearance exist.
    configurePdfNavigation(navigation.navigationBar, settings: kind == "settings")
    self.navigation = navigation
    addSubview(navigation.view)
    navigation.view.frame = bounds
    attach()
    setNeedsLayout()
  }

  private func attach() {
    guard window != nil, let navigation, navigation.parent == nil else { return }
    var responder: UIResponder? = next
    while let current = responder {
      if let parent = current as? UIViewController {
        parent.addChild(navigation)
        navigation.didMove(toParent: parent)
        return
      }
      responder = current.next
    }
  }

  private func detach() {
    guard let navigation, navigation.parent != nil else { return }
    navigation.willMove(toParent: nil)
    navigation.removeFromParent()
  }
}

private final class PdfPanelNavigationController: UINavigationController {
  override var prefersStatusBarHidden: Bool { true }
  override var prefersHomeIndicatorAutoHidden: Bool { true }
}

private func configurePdfNavigation(_ bar: UINavigationBar, settings: Bool) {
  let appearance = UINavigationBarAppearance()
  appearance.configureWithOpaqueBackground()
  appearance.backgroundColor = PdfAppearance.paper
  appearance.shadowColor = .clear
  appearance.titleTextAttributes = [.foregroundColor: PdfAppearance.ink, .font: PdfAppearance.serif(17, weight: .semibold)]
  bar.standardAppearance = appearance
  bar.compactAppearance = appearance
  if #available(iOS 26.0, *), !settings {
    // The original contents sheet inherits BookDesign's transparent scroll edge.
    let scrollEdge = UINavigationBarAppearance()
    scrollEdge.configureWithTransparentBackground()
    scrollEdge.titleTextAttributes = appearance.titleTextAttributes
    bar.scrollEdgeAppearance = scrollEdge
    bar.compactScrollEdgeAppearance = scrollEdge
  } else {
    bar.scrollEdgeAppearance = appearance
    bar.compactScrollEdgeAppearance = appearance
  }
  bar.tintColor = settings ? PdfAppearance.ink2 : PdfAppearance.lamp
}

private final class PdfSettingsController: UIViewController {
  private let action: ([String: Any]) -> Void
  private let mode = UISegmentedControl(items: ["分页", "滚动"])

  init(action: @escaping ([String: Any]) -> Void) {
    self.action = action
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "阅读设置"
    view.backgroundColor = PdfAppearance.paper
    navigationItem.leftBarButtonItem = UIBarButtonItem(title: "关闭", style: .plain, target: self, action: #selector(close))
    navigationItem.rightBarButtonItem = UIBarButtonItem(title: "完成", style: .done, target: self, action: #selector(close))
    // iOS 26 glass done buttons need the item tint as well as the bar tint.
    // These match the original app's installed UIView tint and rendered sheet.
    navigationItem.leftBarButtonItem?.tintColor = PdfAppearance.ink
    navigationItem.rightBarButtonItem?.tintColor = PdfAppearance.lamp
    let heading = PdfAppearance.label(font: PdfAppearance.sans(13, weight: .medium), color: PdfAppearance.ink2)
    heading.text = "阅读方式"
    mode.selectedSegmentTintColor = PdfAppearance.lamp
    mode.setTitleTextAttributes([.foregroundColor: PdfAppearance.ink], for: .selected)
    mode.setTitleTextAttributes([.foregroundColor: PdfAppearance.ink2], for: .normal)
    mode.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    mode.addTarget(self, action: #selector(modeChanged), for: .valueChanged)
    let detail = PdfAppearance.label(font: PdfAppearance.sans(13, style: .footnote), color: PdfAppearance.ink3)
    detail.text = "分页：左右翻页；滚动：上下连续滑动。仅用于本书。"
    detail.numberOfLines = 0
    detail.maximumContentSizeCategory = .extraLarge
    let stack = UIStackView(arrangedSubviews: [heading, mode, detail])
    stack.axis = .vertical
    stack.alignment = .fill
    stack.spacing = 12
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
      stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24)
    ])
  }

  func setFlow(_ flow: String) { loadViewIfNeeded(); mode.selectedSegmentIndex = flow == "scrolled" ? 1 : 0 }
  @objc private func close() { action(["action": "close"]) }
  @objc private func modeChanged() { action(["action": "flow", "flow": mode.selectedSegmentIndex == 1 ? "scrolled" : "paginated"]) }
}

private final class PdfContentsController: UITableViewController, UISearchBarDelegate {
  private let action: ([String: Any]) -> Void
  private let tabs = UISegmentedControl(items: ["目录", "书签", "搜索"])
  private let searchHost = UIView()
  private let searchBar = UISearchBar()
  private var queryEventCount = 0
  private var state: PdfPanelState?
  private let cellID = "pdf-row"

  init(action: @escaping ([String: Any]) -> Void) {
    self.action = action
    super.init(style: .insetGrouped)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "目录与书签"
    tableView.backgroundColor = PdfAppearance.paper
    tableView.separatorColor = PdfAppearance.line
    tableView.separatorInset = UIEdgeInsets(top: 0, left: 20, bottom: 0, right: 20)
    tableView.rowHeight = UITableView.automaticDimension
    tableView.estimatedRowHeight = 56
    tableView.sectionHeaderTopPadding = 20
    tableView.contentInset.bottom = 24
    tableView.keyboardDismissMode = .onDrag
    tableView.register(UITableViewCell.self, forCellReuseIdentifier: cellID)
    tabs.addTarget(self, action: #selector(tabChanged), for: .valueChanged)
    navigationItem.titleView = tabs
    navigationItem.leftBarButtonItem = UIBarButtonItem(title: "完成", style: .done, target: self, action: #selector(close))
    navigationItem.leftBarButtonItem?.tintColor = PdfAppearance.lamp
    searchBar.searchBarStyle = .minimal
    searchBar.placeholder = "搜索这本书"
    searchBar.delegate = self
    searchBar.searchTextField.textColor = PdfAppearance.ink
    searchBar.tintColor = PdfAppearance.lampInk
    searchHost.backgroundColor = PdfAppearance.paper
    searchHost.addSubview(searchBar)
  }

  override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); updateSearchHeader() }
  func setState(_ state: PdfPanelState) {
    loadViewIfNeeded()
    self.state = state
    tabs.selectedSegmentIndex = state.tab == "search" ? 2 : state.tab == "bookmarks" ? 1 : 0
    // RN may acknowledge an earlier edit after UIKit has received the next one.
    // Only the latest acknowledged edit can replace native text (including IME).
    if state.queryEventCount >= queryEventCount {
      queryEventCount = state.queryEventCount
      if searchBar.text != state.query { searchBar.text = state.query }
    }
    searchBar.searchTextField.isEnabled = state.searchEnabled
    updateSearchHeader()
    tableView.reloadData()
  }
  private func updateSearchHeader() {
    guard state?.tab == "search" else { if tableView.tableHeaderView != nil { tableView.tableHeaderView = nil }; return }
    let frame = CGRect(x: 0, y: 0, width: tableView.bounds.width, height: 56)
    searchHost.frame = frame
    searchBar.frame = CGRect(x: 12, y: 8, width: max(0, frame.width - 24), height: 40)
    if tableView.tableHeaderView !== searchHost || tableView.tableHeaderView?.frame.height != 56 { tableView.tableHeaderView = searchHost }
  }
  @objc private func close() { searchBar.resignFirstResponder(); action(["action": "close"]) }
  @objc private func tabChanged() {
    searchBar.resignFirstResponder()
    action(["action": "tab", "tab": tabs.selectedSegmentIndex == 2 ? "search" : tabs.selectedSegmentIndex == 1 ? "bookmarks" : "contents"])
  }
  func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
    queryEventCount += 1
    action(["action": "query", "query": searchText, "eventCount": queryEventCount])
  }
  func searchBarSearchButtonClicked(_ searchBar: UISearchBar) { searchBar.resignFirstResponder() }

  override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { max(1, state?.rows.count ?? 0) }
  override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: cellID, for: indexPath)
    cell.accessoryType = .none
    cell.selectionStyle = .default
    cell.backgroundColor = PdfAppearance.paper
    guard let state, state.rows.indices.contains(indexPath.row) else {
      var content = UIListContentConfiguration.cell()
      content.text = state?.status ?? ""
      content.textProperties.font = PdfAppearance.sans(12, style: .footnote)
      content.textProperties.color = PdfAppearance.ink3
      content.textProperties.numberOfLines = 0
      cell.contentConfiguration = content
      cell.selectionStyle = .none
      return cell
    }
    let row = state.rows[indexPath.row]
    var content = UIListContentConfiguration.subtitleCell()
    content.text = row.title
    content.textProperties.font = PdfAppearance.sans(15, style: .body)
    content.textProperties.color = PdfAppearance.ink
    content.textProperties.numberOfLines = state.tab == "contents" ? 0 : 1
    content.secondaryText = row.detail
    content.secondaryTextProperties.font = PdfAppearance.sans(12, style: .footnote)
    content.secondaryTextProperties.color = PdfAppearance.ink3
    content.secondaryTextProperties.numberOfLines = state.tab == "search" ? 2 : 1
    if state.tab == "contents" { content.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 10, leading: 20 + CGFloat(min(row.depth, 1)) * 16, bottom: 10, trailing: 20) }
    if row.bookmark {
      content.image = PdfAppearance.symbol("bookmark.fill", size: 13)
      content.imageProperties.tintColor = PdfAppearance.lamp
    }
    cell.contentConfiguration = content
    cell.accessoryType = .disclosureIndicator
    return cell
  }
  override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    guard let state, state.rows.indices.contains(indexPath.row) else { return }
    searchBar.resignFirstResponder()
    action(["action": "jump", "id": state.rows[indexPath.row].id])
  }
  override func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
    guard let state, state.rows.indices.contains(indexPath.row), state.rows[indexPath.row].deletable else { return nil }
    let id = state.rows[indexPath.row].id
    let delete = UIContextualAction(style: .destructive, title: "删除") { [weak self] _, _, complete in
      self?.action(["action": "delete", "id": id]); complete(true)
    }
    return UISwipeActionsConfiguration(actions: [delete])
  }
}
