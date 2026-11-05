import ExpoModulesCore
import UIKit

/// Platform appearance only. Reading, navigation and persistence are controlled by TypeScript.
public final class ShudengPdfChromeView: ExpoView {
  let onChromeAction = EventDispatcher()
  private let toolbar = UIView()
  private let topBackdrop = UIView()
  private let footer = UIView()
  private let back = UIButton(type: .system)
  private let bookmark = UIButton(type: .system)
  private let contents = UIButton(type: .system)
  private let help = UIButton(type: .system)
  private let settings = UIButton(type: .system)
  private let ask = UIButton(type: .system)
  private let title = PdfAppearance.label(font: PdfAppearance.serif(15, weight: .semibold))
  private let page = PdfAppearance.label(font: PdfAppearance.sans(13, weight: .medium), color: PdfAppearance.ink2)
  private let progress = UIProgressView(progressViewStyle: .default)
  private let ribbon = UIButton(type: .system)
  private var visible = true
  private var bookmarked = false

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    configureToolbar()
    configureFooter()
    configureRibbon()
    setDark(false)
  }

  func setTitle(_ value: String) { title.text = value }
  func setPage(_ number: Int, total: Int) {
    page.text = total > 0 ? "第 \(number) / \(total) 页" : "第 0 / 0 页"
    let value = total > 1 ? Float(number - 1) / Float(total - 1) : total == 1 ? 1 : 0
    progress.progress = max(0, min(1, value))
    progress.accessibilityValue = "已读 \(Int((value * 100).rounded()))%"
  }
  func setBookmarked(_ value: Bool) {
    bookmarked = value
    bookmark.configuration?.image = PdfAppearance.symbol(value ? "bookmark.fill" : "bookmark", size: 18)
    bookmark.configuration?.baseForegroundColor = value ? PdfAppearance.lampInk : PdfAppearance.ink2
    bookmark.accessibilityLabel = value ? "取消本页书签" : "添加本页书签"
    bookmark.accessibilityValue = value ? "此页已有书签" : nil
    ribbon.isHidden = !value || !visible
  }
  func setHasScannedPages(_ value: Bool) { help.isHidden = !value }
  func setReferenceMode(_ value: Bool) { back.accessibilityLabel = value ? "返回问答" : "书架" }
  func setDark(_ value: Bool) {
    overrideUserInterfaceStyle = value ? .dark : .light
    toolbar.backgroundColor = PdfAppearance.paper.withAlphaComponent(0.94)
    topBackdrop.backgroundColor = PdfAppearance.paper.withAlphaComponent(0.94)
    footer.backgroundColor = PdfAppearance.paper.withAlphaComponent(0.94)
  }
  func setChromeVisible(_ value: Bool) {
    guard visible != value else { return }
    visible = value
    for view in [toolbar, topBackdrop, footer] {
      view.isUserInteractionEnabled = value
      view.accessibilityElementsHidden = !value
      if value { view.isHidden = false }
    }
    ribbon.isHidden = !value || !bookmarked
    UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.2, delay: 0,
                   options: [.beginFromCurrentState, .allowUserInteraction]) {
      for view in [self.toolbar, self.topBackdrop, self.footer] { view.alpha = value ? 1 : 0 }
    } completion: { [weak self] _ in
      guard let self, self.visible == value else { return }
      for view in [self.toolbar, self.topBackdrop, self.footer] { view.isHidden = !value }
    }
  }

  public override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard visible else { return nil }
    let hit = super.hitTest(point, with: event)
    return hit === self ? nil : hit
  }

  public override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    ribbon.layer.borderColor = PdfAppearance.line.resolvedColor(with: traitCollection).cgColor
  }

  private func configureToolbar() {
    for child in [toolbar, topBackdrop, footer] { child.translatesAutoresizingMaskIntoConstraints = false; addSubview(child) }
    topBackdrop.isUserInteractionEnabled = false
    topBackdrop.accessibilityElementsHidden = true
    topBackdrop.accessibilityIdentifier = "pdf-reader-top-backdrop"
    toolbar.accessibilityIdentifier = "pdf-reader-toolbar"
    configure(back, symbol: "arrow.left", label: "书架", action: "back", inset: 0)
    configure(bookmark, symbol: "bookmark", label: "添加本页书签", action: "bookmark")
    configure(contents, symbol: "list.bullet", label: "目录与书签", action: "contents")
    configure(help, symbol: "questionmark.circle", label: "关于这份 PDF", action: "help")
    configure(settings, symbol: "ellipsis", label: "阅读设置", action: "settings")
    back.accessibilityIdentifier = "reader-close"
    bookmark.accessibilityIdentifier = "pdf-bookmark-toggle"
    contents.accessibilityIdentifier = "pdf-contents"
    help.accessibilityIdentifier = "pdf-reader-help"
    settings.accessibilityIdentifier = "pdf-reader-settings"
    help.isHidden = true
    title.textAlignment = .center
    title.lineBreakMode = .byTruncatingTail
    title.numberOfLines = 1
    title.maximumContentSizeCategory = .extraLarge
    title.accessibilityIdentifier = "reader-title"
    title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    let trailing = UIStackView(arrangedSubviews: [bookmark, contents, help, settings])
    trailing.axis = .horizontal
    trailing.alignment = .center
    trailing.spacing = 6
    for child in [back, title, trailing] { child.translatesAutoresizingMaskIntoConstraints = false; toolbar.addSubview(child) }
    let centering = title.centerXAnchor.constraint(equalTo: toolbar.centerXAnchor)
    centering.priority = .defaultLow
    let hairline = PdfAppearance.hairline(in: toolbar)
    NSLayoutConstraint.activate([
      toolbar.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor),
      toolbar.leadingAnchor.constraint(equalTo: leadingAnchor), toolbar.trailingAnchor.constraint(equalTo: trailingAnchor),
      toolbar.heightAnchor.constraint(equalToConstant: 52),
      topBackdrop.topAnchor.constraint(equalTo: topAnchor), topBackdrop.leadingAnchor.constraint(equalTo: leadingAnchor),
      topBackdrop.trailingAnchor.constraint(equalTo: trailingAnchor), topBackdrop.bottomAnchor.constraint(equalTo: toolbar.topAnchor),
      hairline.leadingAnchor.constraint(equalTo: toolbar.leadingAnchor), hairline.trailingAnchor.constraint(equalTo: toolbar.trailingAnchor),
      hairline.bottomAnchor.constraint(equalTo: toolbar.bottomAnchor), hairline.heightAnchor.constraint(equalToConstant: 1),
      back.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 13),
      back.widthAnchor.constraint(equalToConstant: 44), back.heightAnchor.constraint(equalToConstant: 44),
      back.centerYAnchor.constraint(equalTo: toolbar.centerYAnchor),
      trailing.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -16),
      trailing.centerYAnchor.constraint(equalTo: toolbar.centerYAnchor), trailing.heightAnchor.constraint(equalToConstant: 44),
      centering, title.centerYAnchor.constraint(equalTo: toolbar.centerYAnchor),
      title.leadingAnchor.constraint(greaterThanOrEqualTo: back.trailingAnchor, constant: 8),
      title.trailingAnchor.constraint(lessThanOrEqualTo: trailing.leadingAnchor, constant: -8)
    ])
  }

  private func configureFooter() {
    footer.accessibilityIdentifier = "pdf-reader-footer"
    page.textAlignment = .center
    page.numberOfLines = 1
    page.maximumContentSizeCategory = .extraLarge
    progress.progressTintColor = PdfAppearance.lamp
    progress.trackTintColor = PdfAppearance.line
    progress.accessibilityLabel = "阅读进度"
    var configuration = UIButton.Configuration.plain()
    configuration.title = "问书灯"
    configuration.image = PdfAppearance.symbol("lightbulb", size: 14)
    configuration.imagePadding = 5
    configuration.baseForegroundColor = PdfAppearance.lampInk
    configuration.contentInsets = .zero
    configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
      var next = incoming
      next.font = UIFontMetrics(forTextStyle: .subheadline).scaledFont(for: .systemFont(ofSize: 12, weight: .medium), maximumPointSize: 16)
      return next
    }
    ask.configuration = configuration
    ask.accessibilityLabel = "问问书灯"
    ask.addAction(UIAction { [weak self] _ in self?.onChromeAction(["action": "ask"]) }, for: .touchUpInside)
    for child in [ask, page, progress] { child.translatesAutoresizingMaskIntoConstraints = false; footer.addSubview(child) }
    let hairline = PdfAppearance.hairline(in: footer)
    NSLayoutConstraint.activate([
      footer.leadingAnchor.constraint(equalTo: leadingAnchor), footer.trailingAnchor.constraint(equalTo: trailingAnchor),
      footer.bottomAnchor.constraint(equalTo: bottomAnchor),
      hairline.leadingAnchor.constraint(equalTo: footer.leadingAnchor), hairline.trailingAnchor.constraint(equalTo: footer.trailingAnchor),
      hairline.topAnchor.constraint(equalTo: footer.topAnchor), hairline.heightAnchor.constraint(equalToConstant: 1),
      page.topAnchor.constraint(equalTo: footer.topAnchor, constant: 10), page.centerXAnchor.constraint(equalTo: footer.centerXAnchor),
      page.leadingAnchor.constraint(greaterThanOrEqualTo: ask.trailingAnchor, constant: 8),
      ask.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 14),
      ask.centerYAnchor.constraint(equalTo: page.centerYAnchor), ask.heightAnchor.constraint(equalToConstant: 44),
      page.trailingAnchor.constraint(lessThanOrEqualTo: safeAreaLayoutGuide.trailingAnchor, constant: -28),
      progress.topAnchor.constraint(equalTo: page.bottomAnchor, constant: 6),
      progress.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 28),
      progress.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -28),
      progress.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor, constant: -10)
    ])
  }

  private func configureRibbon() {
    configure(ribbon, symbol: "bookmark.fill", label: "取消本页书签", action: "bookmark", inset: 0, size: 14)
    ribbon.configuration?.baseForegroundColor = PdfAppearance.lampInk
    ribbon.backgroundColor = PdfAppearance.paper
    ribbon.layer.cornerRadius = 7
    ribbon.layer.cornerCurve = .continuous
    ribbon.layer.borderWidth = 1
    ribbon.layer.borderColor = PdfAppearance.line.resolvedColor(with: traitCollection).cgColor
    ribbon.layer.shadowColor = UIColor.black.cgColor
    ribbon.layer.shadowOpacity = 0.08
    ribbon.layer.shadowRadius = 2
    ribbon.layer.shadowOffset = CGSize(width: 0, height: 1)
    ribbon.isHidden = true
    ribbon.translatesAutoresizingMaskIntoConstraints = false
    addSubview(ribbon)
    NSLayoutConstraint.activate([
      ribbon.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -12),
      ribbon.topAnchor.constraint(equalTo: toolbar.bottomAnchor, constant: 10),
      ribbon.widthAnchor.constraint(equalToConstant: 26), ribbon.heightAnchor.constraint(equalToConstant: 38)
    ])
  }

  private func configure(_ button: UIButton, symbol: String, label: String, action: String, inset: CGFloat = 13, size: CGFloat = 18) {
    var configuration = UIButton.Configuration.plain()
    configuration.image = PdfAppearance.symbol(symbol, size: size)
    configuration.baseForegroundColor = PdfAppearance.ink2
    configuration.contentInsets = NSDirectionalEdgeInsets(top: inset, leading: inset, bottom: inset, trailing: inset)
    button.configuration = configuration
    button.accessibilityLabel = label
    button.addAction(UIAction { [weak self] _ in self?.onChromeAction(["action": action]) }, for: .touchUpInside)
  }
}

enum PdfAppearance {
  static let paper = color(0xFAF7F1, 0x1B1A17)
  static let ink = color(0x211E18, 0xF3EEE3)
  static let ink2 = color(0x57534A, 0xC3BCAE)
  static let ink3 = color(0x6E6A60, 0x948D80)
  static let line = color(0xE7E0D2, 0x3A362F)
  static let lamp = color(0xB4712A, 0xE0AE6A)
  static let lampInk = color(0x8A5413, 0xF0C98B)
  static func color(_ light: UInt32, _ dark: UInt32) -> UIColor {
    UIColor { traits in
      let value = traits.userInterfaceStyle == .dark ? dark : light
      return UIColor(red: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
    }
  }
  static func sans(_ size: CGFloat, weight: UIFont.Weight = .regular, style: UIFont.TextStyle = .subheadline) -> UIFont {
    UIFontMetrics(forTextStyle: style).scaledFont(for: .systemFont(ofSize: size, weight: weight))
  }
  static func serif(_ size: CGFloat, weight: UIFont.Weight = .regular) -> UIFont {
    let name = weight.rawValue >= UIFont.Weight.semibold.rawValue ? "SongtiSC-Bold" : "SongtiSC-Regular"
    return UIFontMetrics(forTextStyle: .subheadline).scaledFont(for: UIFont(name: name, size: size) ?? .systemFont(ofSize: size, weight: weight))
  }
  static func label(font: UIFont, color: UIColor = ink) -> UILabel {
    let label = UILabel()
    label.font = font; label.textColor = color; label.adjustsFontForContentSizeCategory = true
    return label
  }
  static func symbol(_ name: String, size: CGFloat) -> UIImage? {
    UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: size, weight: .medium))
  }
  static func hairline(in parent: UIView) -> UIView {
    let view = UIView(); view.backgroundColor = line; view.translatesAutoresizingMaskIntoConstraints = false; parent.addSubview(view)
    return view
  }
}
