import ExpoModulesCore
import UIKit

/// UIKit appearance and hit testing only. RN owns navigation, reader state and storage.
final class ShudengEpubChromeView: ExpoView {
  let onChromeAction = EventDispatcher()
  private let toolbar = EpubChromeToolbar()
  private let footer = EpubChromeFooter()
  private let ribbon = EpubChromeRibbon(type: .system)
  private var title = ""
  private var chapter = ""
  private var referenceMode = false
  private var chromeVisible = true
  private var bookmarked = false
  private var controlsGeneration = 0
  private var ribbonGeneration = 0

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    isAccessibilityElement = false
    for child in [toolbar, footer, ribbon] {
      child.translatesAutoresizingMaskIntoConstraints = false
      addSubview(child)
    }
    NSLayoutConstraint.activate([
      toolbar.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor),
      toolbar.leadingAnchor.constraint(equalTo: leadingAnchor),
      toolbar.trailingAnchor.constraint(equalTo: trailingAnchor),
      toolbar.heightAnchor.constraint(equalToConstant: 64),
      footer.leadingAnchor.constraint(equalTo: leadingAnchor),
      footer.trailingAnchor.constraint(equalTo: trailingAnchor),
      footer.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor),
      footer.heightAnchor.constraint(equalToConstant: 76),
      ribbon.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -2),
      ribbon.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor, constant: 74),
      ribbon.widthAnchor.constraint(equalToConstant: 24),
      ribbon.heightAnchor.constraint(equalToConstant: 34)
    ])
    toolbar.back.addAction(intent("back"), for: .touchUpInside)
    toolbar.contents.addAction(intent("contents"), for: .touchUpInside)
    toolbar.settings.addAction(intent("settings"), for: .touchUpInside)
    footer.ask.addAction(intent("ask"), for: .touchUpInside)
    ribbon.addAction(intent("bookmark"), for: .touchUpInside)
    ribbon.isHidden = true
    ribbon.alpha = 0
    ribbon.isUserInteractionEnabled = false
    ribbon.accessibilityElementsHidden = true
    updateAccessibilityAction()
  }

  private func intent(_ action: String) -> UIAction {
    UIAction { [weak self] _ in self?.onChromeAction(["action": action]) }
  }

  func setTitle(_ value: String) { title = value; updateHeading() }
  func setChapter(_ value: String) { chapter = value; updateHeading(); footer.setChapter(value) }
  func setProgress(_ value: String) { footer.setProgress(value) }
  func setReferenceMode(_ value: Bool) { referenceMode = value; updateHeading() }
  func setControlsEnabled(_ value: Bool) { toolbar.setControlsEnabled(value) }
  func setDark(_ value: Bool) { overrideUserInterfaceStyle = value ? .dark : .light }

  private func updateHeading() { toolbar.configure(title: title, chapter: chapter, reference: referenceMode) }

  func setChromeVisible(_ visible: Bool) {
    guard chromeVisible != visible else { return }
    chromeVisible = visible
    controlsGeneration += 1
    let generation = controlsGeneration
    for control in [toolbar, footer] {
      control.isHidden = false
      control.accessibilityElementsHidden = !visible
      control.isUserInteractionEnabled = visible
    }
    UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.2, delay: 0,
      options: [.beginFromCurrentState, .allowUserInteraction, .curveEaseInOut]) {
      self.toolbar.alpha = visible ? 1 : 0
      self.footer.alpha = visible ? 1 : 0
    } completion: { [weak self] _ in
      guard let self, generation == self.controlsGeneration else { return }
      for control in [self.toolbar, self.footer] { control.isHidden = !visible }
    }
    updateAccessibilityAction()
  }

  func setBookmarked(_ visible: Bool) {
    ribbon.accessibilityLabel = visible ? "取消本页书签" : "添加本页书签"
    ribbon.accessibilityValue = visible ? "此页已有书签" : nil
    ribbon.accessibilityHint = visible ? "轻点删除此页书签" : "轻点在此页添加书签"
    guard bookmarked != visible else { return }
    bookmarked = visible
    ribbonGeneration += 1
    let generation = ribbonGeneration
    ribbon.isUserInteractionEnabled = visible
    ribbon.accessibilityElementsHidden = !visible
    if visible {
      ribbon.isHidden = false
      ribbon.alpha = 0
      ribbon.transform = CGAffineTransform(scaleX: 0.7, y: 0.7)
      UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.22, delay: 0,
        usingSpringWithDamping: 0.72, initialSpringVelocity: 0.4,
        options: [.beginFromCurrentState, .allowUserInteraction]) {
        self.ribbon.alpha = 1
        self.ribbon.transform = .identity
      }
    } else {
      UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.15, delay: 0,
        options: [.beginFromCurrentState, .allowUserInteraction]) {
        self.ribbon.alpha = 0
      } completion: { [weak self] _ in
        guard let self, generation == self.ribbonGeneration, !self.bookmarked else { return }
        self.ribbon.isHidden = true
      }
    }
  }

  /// Only controls intercept touches; live EPUB selection and paging stay underneath.
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let hit = super.hitTest(point, with: event)
    return hit === self ? nil : hit
  }

  private func updateAccessibilityAction() {
    accessibilityCustomActions = [UIAccessibilityCustomAction(name: chromeVisible ? "隐藏工具栏" : "显示工具栏",
      target: self, selector: #selector(toggleChrome))]
  }
  @objc private func toggleChrome() -> Bool { onChromeAction(["action": "toggleChrome"]); return true }
}

private final class EpubChromeToolbar: UIView {
  let back = UIButton(type: .system)
  let contents = UIButton(type: .system)
  let settings = UIButton(type: .system)
  private let title = EpubChromeAppearance.label(12, weight: .medium, style: .subheadline, color: EpubChromeAppearance.ink2)
  private let chapter = EpubChromeAppearance.label(10.5, weight: .medium, style: .caption1, color: EpubChromeAppearance.ink3)
  private let leading = UIView()
  private let trailing = UIView()
  private var leadingWidth: NSLayoutConstraint!
  private var backWidth: NSLayoutConstraint!

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = EpubChromeAppearance.paper.withAlphaComponent(0.94)
    accessibilityIdentifier = "reader-toolbar"
    let line = UIView()
    line.backgroundColor = EpubChromeAppearance.line
    line.translatesAutoresizingMaskIntoConstraints = false
    addSubview(line)
    configure(back, symbol: "arrow.left", label: "书架", identifier: "reader-close")
    configure(contents, symbol: "list.bullet", label: "目录与书签", identifier: "reader-contents")
    configure(settings, symbol: "ellipsis", label: "阅读设置", identifier: "reader-settings")
    title.accessibilityIdentifier = "reader-title"
    chapter.accessibilityIdentifier = "reader-chapter"
    for label in [title, chapter] { label.textAlignment = .center; label.lineBreakMode = .byTruncatingTail }
    let headings = UIStackView(arrangedSubviews: [title, chapter])
    headings.axis = .vertical
    headings.alignment = .fill
    headings.spacing = 1
    let actions = UIStackView(arrangedSubviews: [contents, settings])
    actions.axis = .horizontal
    actions.spacing = 0
    for child in [leading, trailing, headings] { child.translatesAutoresizingMaskIntoConstraints = false; addSubview(child) }
    back.translatesAutoresizingMaskIntoConstraints = false
    leading.addSubview(back)
    actions.translatesAutoresizingMaskIntoConstraints = false
    trailing.addSubview(actions)
    leadingWidth = leading.widthAnchor.constraint(equalToConstant: 88)
    backWidth = back.widthAnchor.constraint(equalToConstant: 44)
    NSLayoutConstraint.activate([
      line.leadingAnchor.constraint(equalTo: leadingAnchor), line.trailingAnchor.constraint(equalTo: trailingAnchor),
      line.bottomAnchor.constraint(equalTo: bottomAnchor), line.heightAnchor.constraint(equalToConstant: 1),
      leadingWidth, backWidth,
      leading.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 13),
      leading.centerYAnchor.constraint(equalTo: centerYAnchor), leading.heightAnchor.constraint(equalToConstant: 44),
      trailing.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -13),
      trailing.centerYAnchor.constraint(equalTo: centerYAnchor),
      trailing.widthAnchor.constraint(equalToConstant: 88), trailing.heightAnchor.constraint(equalToConstant: 44),
      back.leadingAnchor.constraint(equalTo: leading.leadingAnchor), back.centerYAnchor.constraint(equalTo: leading.centerYAnchor),
      back.heightAnchor.constraint(equalToConstant: 44), back.trailingAnchor.constraint(lessThanOrEqualTo: leading.trailingAnchor),
      actions.topAnchor.constraint(equalTo: trailing.topAnchor), actions.bottomAnchor.constraint(equalTo: trailing.bottomAnchor),
      actions.leadingAnchor.constraint(equalTo: trailing.leadingAnchor), actions.trailingAnchor.constraint(equalTo: trailing.trailingAnchor),
      contents.widthAnchor.constraint(equalToConstant: 44), settings.widthAnchor.constraint(equalToConstant: 44),
      headings.centerXAnchor.constraint(equalTo: centerXAnchor), headings.centerYAnchor.constraint(equalTo: centerYAnchor),
      headings.leadingAnchor.constraint(greaterThanOrEqualTo: leading.trailingAnchor, constant: 4),
      headings.trailingAnchor.constraint(lessThanOrEqualTo: trailing.leadingAnchor, constant: -4)
    ])
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func configure(title: String, chapter: String, reference: Bool) {
    self.title.text = title
    self.chapter.text = (reference ? "查看引用 1 · " : "") + chapter
    leadingWidth.constant = reference ? 112 : 88
    backWidth.constant = reference ? 112 : 44
    back.configuration?.title = reference ? "返回问答" : nil
    back.accessibilityLabel = reference ? "返回问答" : "书架"
    back.accessibilityHint = reference ? nil : "返回书架"
    back.accessibilityIdentifier = reference ? "reader-return-question" : "reader-close"
  }
  func setControlsEnabled(_ enabled: Bool) { contents.isEnabled = enabled; settings.isEnabled = enabled }

  private func configure(_ button: UIButton, symbol: String, label: String, identifier: String) {
    var config = UIButton.Configuration.plain()
    config.image = EpubChromeAppearance.symbol(symbol, size: 18, weight: .medium)
    config.baseForegroundColor = EpubChromeAppearance.ink2
    config.contentInsets = .zero
    config.imagePlacement = .leading
    config.imagePadding = 5
    config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
      var attributes = incoming
      attributes.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 14, weight: .medium), maximumPointSize: 17)
      return attributes
    }
    button.configuration = config
    button.accessibilityLabel = label
    button.accessibilityIdentifier = identifier
    button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
  }
}

private final class EpubChromeFooter: UIView {
  let ask = EpubChromeAskButton(type: .system)
  private let progress = EpubChromeAppearance.label(10.5, weight: .medium, style: .caption1, color: EpubChromeAppearance.ink3)
  private let chapter = EpubChromeAppearance.label(10.5, weight: .medium, style: .caption1, color: EpubChromeAppearance.ink3)

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = EpubChromeAppearance.paper
    accessibilityIdentifier = "reader-footer"
    var config = UIButton.Configuration.plain()
    config.title = "问问书灯"
    config.image = EpubChromeAppearance.symbol("lightbulb", size: 16)
    config.imagePadding = 6
    config.baseForegroundColor = EpubChromeAppearance.ink
    config.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 14)
    config.background.backgroundColor = EpubChromeAppearance.surface
    config.background.cornerRadius = 999
    config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
      var attributes = incoming
      attributes.font = UIFontMetrics(forTextStyle: .footnote).scaledFont(for: .systemFont(ofSize: 12, weight: .medium), maximumPointSize: 16)
      return attributes
    }
    ask.configuration = config
    ask.accessibilityLabel = "问问书灯"
    ask.accessibilityIdentifier = "reader-ask-book"
    ask.layer.shadowColor = UIColor.black.cgColor
    ask.layer.shadowOpacity = 0.16
    ask.layer.shadowRadius = 22
    ask.layer.shadowOffset = CGSize(width: 0, height: 8)
    progress.accessibilityIdentifier = "reader-progress"
    chapter.accessibilityIdentifier = "reader-footer-chapter"
    chapter.textAlignment = .right
    chapter.lineBreakMode = .byTruncatingHead
    for child in [ask, progress, chapter] { child.translatesAutoresizingMaskIntoConstraints = false; addSubview(child) }
    NSLayoutConstraint.activate([
      ask.centerXAnchor.constraint(equalTo: safeAreaLayoutGuide.centerXAnchor),
      ask.heightAnchor.constraint(equalToConstant: 36), ask.topAnchor.constraint(equalTo: topAnchor, constant: 4),
      progress.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 26),
      progress.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -10),
      chapter.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -26),
      chapter.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -10),
      chapter.leadingAnchor.constraint(greaterThanOrEqualTo: progress.trailingAnchor, constant: 12)
    ])
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
  func setProgress(_ value: String) { progress.text = value }
  func setChapter(_ value: String) { chapter.text = value }
}

private final class EpubChromeAskButton: UIButton {
  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    bounds.insetBy(dx: 0, dy: -max(0, (44 - bounds.height) / 2)).contains(point)
  }
}

private final class EpubChromeRibbon: UIButton {
  override init(frame: CGRect) {
    super.init(frame: frame)
    var config = UIButton.Configuration.plain()
    config.image = EpubChromeAppearance.symbol("bookmark.fill", size: 15, weight: .semibold)
    config.baseForegroundColor = EpubChromeAppearance.lampInk
    config.contentInsets = .zero
    configuration = config
    backgroundColor = EpubChromeAppearance.paper
    layer.cornerRadius = 7
    layer.cornerCurve = .continuous
    layer.borderWidth = 1
    layer.shadowColor = UIColor.black.cgColor
    layer.shadowOpacity = 0.08
    layer.shadowRadius = 2
    layer.shadowOffset = CGSize(width: 0, height: 1)
    accessibilityIdentifier = "reader-bookmark-ribbon"
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
  override func layoutSubviews() {
    super.layoutSubviews()
    layer.borderColor = EpubChromeAppearance.line.resolvedColor(with: traitCollection).cgColor
  }
}

private enum EpubChromeAppearance {
  static let paper = color(0xFAF7F1, 0x1B1A17)
  static let surface = color(0xFFFFFF, 0x2A2723)
  static let ink = color(0x211E18, 0xF3EEE3)
  static let ink2 = color(0x57534A, 0xC3BCAE)
  static let ink3 = color(0x6E6A60, 0x948D80)
  static let line = color(0xE7E0D2, 0x3A362F)
  static let lampInk = color(0x8A5413, 0xF0C98B)
  private static func color(_ light: Int, _ dark: Int) -> UIColor {
    UIColor { traits in
      let value = traits.userInterfaceStyle == .dark ? dark : light
      return UIColor(red: CGFloat((value >> 16) & 255) / 255,
        green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
    }
  }
  static func label(_ size: CGFloat, weight: UIFont.Weight, style: UIFont.TextStyle, color: UIColor) -> UILabel {
    let label = UILabel()
    label.font = UIFontMetrics(forTextStyle: style).scaledFont(for: .systemFont(ofSize: size, weight: weight))
    label.textColor = color
    label.numberOfLines = 1
    label.adjustsFontForContentSizeCategory = true
    label.maximumContentSizeCategory = .extraLarge
    return label
  }
  static func symbol(_ name: String, size: CGFloat, weight: UIImage.SymbolWeight = .regular) -> UIImage? {
    UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: size, weight: weight))
  }
}
