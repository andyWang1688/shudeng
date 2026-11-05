import ExpoModulesCore
import UIKit

private struct EpubSettingsValue: Decodable {
  let flow: String
  let fontScale: Double
  let theme: String
}

/// A presentation port: RN owns the draft, validation and persistence.
/// This view presents UIKit controls and forwards user intents without saving.
final class ShudengEpubSettingsView: ExpoView, UIAdaptivePresentationControllerDelegate {
  let onSettingsAction = EventDispatcher()
  private var wantsVisible = false
  private var value: EpubSettingsValue?
  private var saving = false
  private var dark = false
  private var curlAvailable = true
  private var navigation: UINavigationController?
  private var controller: EpubSettingsController?
  private var scheduled = false
  private var dismissing = false

  func setVisible(_ visible: Bool) { wantsVisible = visible; schedule() }
  func setValue(_ json: String) {
    guard let data = json.data(using: .utf8),
      let value = try? JSONDecoder().decode(EpubSettingsValue.self, from: data) else { return }
    self.value = value
    updateControls()
    schedule()
  }
  func setSaving(_ value: Bool) { saving = value; updateControls() }
  func setCurlAvailable(_ value: Bool) { curlAvailable = value; updateControls() }
  func setDark(_ value: Bool) {
    dark = value
    navigation?.overrideUserInterfaceStyle = value ? .dark : .light
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { dismiss(animated: false) } else { schedule() }
  }

  private func schedule() {
    guard !scheduled else { return }
    scheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.scheduled = false
      self.reconcilePresentation()
    }
  }

  private func reconcilePresentation() {
    guard wantsVisible, window != nil else { dismiss(animated: window != nil); return }
    guard navigation == nil, !dismissing, let value, let presenter = presentingController(),
      presenter.viewIfLoaded?.window != nil else { return }
    let controller = EpubSettingsController(value: value) { [weak self] action in self?.onSettingsAction(action) }
    let navigation = UINavigationController(rootViewController: controller)
    // A plain navigation controller uses adaptive presentation; UIKit owns
    // the sheet frame instead of a second, explicit pageSheet policy.
    navigation.modalPresentationStyle = .automatic
    navigation.overrideUserInterfaceStyle = dark ? .dark : .light
    navigation.view.tintColor = EpubSettingsAppearance.lamp
    navigation.sheetPresentationController?.detents = [.large()]
    navigation.presentationController?.delegate = self
    configureEpubSettingsNavigation(navigation.navigationBar)
    self.controller = controller
    self.navigation = navigation
    updateControls()
    presenter.present(navigation, animated: true)
  }

  private func presentingController() -> UIViewController? {
    var responder: UIResponder? = next
    while let current = responder {
      if var presenter = current as? UIViewController {
        while let presented = presenter.presentedViewController {
          guard !presented.isBeingDismissed else { return nil }
          presenter = presented
        }
        return presenter
      }
      responder = current.next
    }
    return nil
  }

  private func updateControls() {
    if let value { controller?.update(value: value, saving: saving, curlAvailable: curlAvailable) }
    navigation?.isModalInPresentation = saving
  }

  private func dismiss(animated: Bool) {
    guard let navigation, !dismissing else { return }
    dismissing = true
    navigation.dismiss(animated: animated) { [weak self, weak navigation] in
      guard let self, self.navigation === navigation else { return }
      self.navigation = nil
      self.controller = nil
      self.dismissing = false
      self.schedule()
    }
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    guard presentationController.presentedViewController === navigation else { return }
    navigation = nil
    controller = nil
    wantsVisible = false
    onSettingsAction(["action": "cancel"])
  }
}

private enum EpubSettingsAppearance {
  static let paper = color(0xFAF7F1, 0x1B1A17)
  static let surface = color(0xFFFFFF, 0x2A2723)
  static let ink = color(0x211E18, 0xF3EEE3)
  static let ink3 = color(0x6E6A60, 0x948D80)
  static let line = color(0xE7E0D2, 0x3A362F)
  static let lamp = color(0xB4712A, 0xE0AE6A)

  private static func color(_ light: Int, _ dark: Int) -> UIColor {
    UIColor { traits in
      let value = traits.userInterfaceStyle == .dark ? dark : light
      return UIColor(red: CGFloat((value >> 16) & 255) / 255,
        green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
    }
  }

  static func serif(_ size: CGFloat, style: UIFont.TextStyle) -> UIFont {
    UIFontMetrics(forTextStyle: style).scaledFont(for: UIFont(name: "SongtiSC-Bold", size: size)
      ?? .systemFont(ofSize: size, weight: .semibold))
  }
}

private func configureEpubSettingsNavigation(_ bar: UINavigationBar) {
  let standard = UINavigationBarAppearance()
  standard.configureWithOpaqueBackground()
  standard.backgroundColor = EpubSettingsAppearance.paper
  standard.shadowColor = .clear
  standard.titleTextAttributes = [.foregroundColor: EpubSettingsAppearance.ink,
    .font: EpubSettingsAppearance.serif(17, style: .headline)]
  standard.largeTitleTextAttributes = [.foregroundColor: EpubSettingsAppearance.ink,
    .font: EpubSettingsAppearance.serif(30, style: .largeTitle)]
  bar.standardAppearance = standard
  bar.compactAppearance = standard
  if #available(iOS 26.0, *) {
    let scrollEdge = UINavigationBarAppearance()
    scrollEdge.configureWithTransparentBackground()
    scrollEdge.titleTextAttributes = standard.titleTextAttributes
    scrollEdge.largeTitleTextAttributes = standard.largeTitleTextAttributes
    bar.scrollEdgeAppearance = scrollEdge
    bar.compactScrollEdgeAppearance = scrollEdge
  } else {
    bar.scrollEdgeAppearance = standard
  }
  bar.tintColor = EpubSettingsAppearance.lamp
}

private final class EpubSettingsController: UITableViewController {
  private var value: EpubSettingsValue
  private var saving = false
  private var curlAvailable = true
  private let action: ([String: Any]) -> Void
  private let mode = UISegmentedControl(items: ["分页", "滚动", "仿真"])
  private let theme = UISegmentedControl(items: ["明亮", "深色"])
  private let size = UILabel()
  private let decrease = UIButton(type: .system)
  private let increase = UIButton(type: .system)
  private lazy var sizeRow = makeSizeRow()
  private let sectionTitles = ["阅读方式", "字号", "主题"]

  init(value: EpubSettingsValue, action: @escaping ([String: Any]) -> Void) {
    self.value = value
    self.action = action
    super.init(style: .insetGrouped)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "阅读设置"
    view.backgroundColor = EpubSettingsAppearance.paper
    view.tintColor = EpubSettingsAppearance.lamp
    tableView.backgroundColor = EpubSettingsAppearance.paper
    tableView.separatorColor = EpubSettingsAppearance.line
    tableView.separatorInset = UIEdgeInsets(top: 0, left: 20, bottom: 0, right: 20)
    tableView.rowHeight = UITableView.automaticDimension
    tableView.estimatedRowHeight = 56
    tableView.sectionHeaderTopPadding = 20
    tableView.contentInset = UIEdgeInsets(top: 0, left: 0, bottom: 24, right: 0)
    tableView.register(EpubSettingsControlCell.self, forCellReuseIdentifier: "settings-control")
    navigationItem.leftBarButtonItem = UIBarButtonItem(title: "取消", style: .plain, target: self, action: #selector(cancel))
    navigationItem.rightBarButtonItem = UIBarButtonItem(title: "完成", style: .done, target: self, action: #selector(done))
    navigationItem.leftBarButtonItem?.tintColor = EpubSettingsAppearance.ink
    navigationItem.rightBarButtonItem?.tintColor = EpubSettingsAppearance.lamp
    for control in [mode, theme] { control.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true }
    mode.addTarget(self, action: #selector(flowChanged), for: .valueChanged)
    theme.addTarget(self, action: #selector(themeChanged), for: .valueChanged)
    decrease.addTarget(self, action: #selector(smaller), for: .touchUpInside)
    increase.addTarget(self, action: #selector(larger), for: .touchUpInside)
    updateControls()
  }

  func update(value: EpubSettingsValue, saving: Bool, curlAvailable: Bool) {
    self.value = value
    self.saving = saving
    self.curlAvailable = curlAvailable
    if isViewLoaded { updateControls() }
  }

  private func updateControls() {
    mode.selectedSegmentIndex = value.flow == "curl" ? 2 : value.flow == "scrolled" ? 1 : 0
    theme.selectedSegmentIndex = value.theme == "dark" ? 1 : 0
    mode.isEnabled = !saving
    mode.setEnabled(curlAvailable, forSegmentAt: 2)
    theme.isEnabled = !saving
    size.text = "\(Int((value.fontScale * 100).rounded()))%"
    size.textColor = EpubSettingsAppearance.ink
    decrease.isEnabled = !saving && value.fontScale > 0.75
    increase.isEnabled = !saving && value.fontScale < 2
    navigationItem.leftBarButtonItem?.isEnabled = !saving
    navigationItem.rightBarButtonItem?.isEnabled = !saving
  }

  private func makeSizeRow() -> UIStackView {
    size.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 15))
    size.adjustsFontForContentSizeCategory = true
    size.textAlignment = .center
    size.accessibilityIdentifier = "font-size"
    for (button, title, label) in [(decrease, "A−", "缩小字号"), (increase, "A+", "增大字号")] {
      var configuration = UIButton.Configuration.plain()
      configuration.title = title
      button.configuration = configuration
      button.accessibilityLabel = label
      button.widthAnchor.constraint(equalToConstant: 44).isActive = true
      button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    }
    let stack = UIStackView(arrangedSubviews: [decrease, size, increase])
    stack.axis = .horizontal
    stack.alignment = .center
    stack.spacing = 12
    size.setContentHuggingPriority(.defaultLow, for: .horizontal)
    return stack
  }

  override func numberOfSections(in tableView: UITableView) -> Int { sectionTitles.count }
  override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { 1 }
  override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { sectionTitles[section] }
  override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? { section == 2 ? "仅用于本书" : nil }
  override func tableView(_ tableView: UITableView, willDisplayHeaderView view: UIView, forSection section: Int) { configureHeaderFooter(view) }
  override func tableView(_ tableView: UITableView, willDisplayFooterView view: UIView, forSection section: Int) { configureHeaderFooter(view) }
  override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = tableView.dequeueReusableCell(withIdentifier: "settings-control", for: indexPath)
    if let cell = cell as? EpubSettingsControlCell {
      switch indexPath.section {
      case 0: cell.host(mode)
      case 1: cell.host(sizeRow)
      default: cell.host(theme)
      }
    }
    return cell
  }
  private func configureHeaderFooter(_ view: UIView) {
    guard let container = view as? UITableViewHeaderFooterView else { return }
    container.contentView.backgroundColor = EpubSettingsAppearance.paper
    container.textLabel?.font = UIFontMetrics(forTextStyle: .caption1).scaledFont(for: .systemFont(ofSize: 10.5, weight: .medium))
    container.textLabel?.textColor = EpubSettingsAppearance.ink3
    container.textLabel?.numberOfLines = 0
  }

  @objc private func cancel() { if !saving { action(["action": "cancel"]) } }
  @objc private func done() { if !saving { action(["action": "done"]) } }
  @objc private func flowChanged() { action(["action": "flow", "value": ["paginated", "scrolled", "curl"][mode.selectedSegmentIndex]]) }
  @objc private func themeChanged() { action(["action": "theme", "value": theme.selectedSegmentIndex == 1 ? "dark" : "light"]) }
  @objc private func smaller() { action(["action": "fontStep", "delta": -1]) }
  @objc private func larger() { action(["action": "fontStep", "delta": 1]) }
}

private final class EpubSettingsControlCell: UITableViewCell {
  private var hosted: UIView?
  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    selectionStyle = .none
    backgroundColor = EpubSettingsAppearance.surface
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func host(_ view: UIView) {
    guard hosted !== view || view.superview !== contentView else { return }
    hosted?.removeFromSuperview()
    view.removeFromSuperview()
    view.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(view)
    NSLayoutConstraint.activate([
      view.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 10),
      view.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -10),
      view.leadingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.leadingAnchor),
      view.trailingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.trailingAnchor)
    ])
    hosted = view
  }
}
