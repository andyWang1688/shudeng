import UIKit
import ReadiumShared

/// 纸与灯 / Paper & Lamp —— 2026-10-27 确认的视觉系统令牌。
/// 规范：docs/design/2026-10-27/visual-system/visual-system.md
enum BookDesign {
    // MARK: 颜色（浅 / 深）

    static let paper = colour(0xFAF7F1, 0x1B1A17)
    static let paperDeep = colour(0xF2EDE2, 0x24221E)
    static let surface = colour(0xFFFFFF, 0x2A2723)
    static let ink = colour(0x211E18, 0xF3EEE3)
    static let ink2 = colour(0x57534A, 0xC3BCAE)
    static let ink3 = colour(0x6E6A60, 0x948D80)
    static let line = colour(0xE7E0D2, 0x3A362F)
    static let lamp = colour(0xB4712A, 0xE0AE6A)
    static let lampInk = colour(0x8A5413, 0xF0C98B)
    static let lampWash = colour(0xF6E7CC, 0x3A2F1F)
    static let selection = colour(0xF2DBA6, 0x5A4A2A)
    static let error = colour(0xA63A2B, 0xF0A79A)
    static let errorWash = colour(0xF8E7E1, 0x3A2823)

    // MARK: 高亮四色（浅色低饱和纸色 / 深色深底亮字；旧数据 nil 语义=黄）
    static let highlightYellow = selection
    static let highlightGreen = colour(0xDEE8D3, 0x30402C)
    static let highlightBlue = colour(0xDCE6EC, 0x2C3A44)
    static let highlightRose = colour(0xF3DEDA, 0x472F2C)

    // 旧名称保留为别名，避免一次性改动所有调用方；新代码请使用上面的语义令牌。
    static let accentWash = lampWash
    static let glow = lampWash
    static let wash = paperDeep
    static let secondary = ink2

    private static func colour(_ light: Int, _ dark: Int) -> UIColor {
        UIColor { rgb($0.userInterfaceStyle == .dark ? dark : light) }
    }

    static func rgb(_ value: Int) -> UIColor {
        UIColor(red: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255,
                blue: CGFloat(value & 255) / 255, alpha: 1)
    }

    // MARK: 字体工具

    static func font(_ size: CGFloat, weight: UIFont.Weight = .regular, style: UIFont.TextStyle = .body) -> UIFont {
        UIFontMetrics(forTextStyle: style).scaledFont(for: .systemFont(ofSize: size, weight: weight))
    }

    static func readingFont(_ size: CGFloat = 17) -> UIFont {
        UIFontMetrics(forTextStyle: .body).scaledFont(for: UIFont(name: "SongtiSC-Regular", size: size) ?? .systemFont(ofSize: size))
    }

    // MARK: 外观安装

    static func install() {
        UIView.appearance().tintColor = lamp
        let navigation = UINavigationBarAppearance()
        navigation.configureWithOpaqueBackground()
        navigation.backgroundColor = paper
        navigation.shadowColor = .clear
        navigation.titleTextAttributes = [.foregroundColor: ink, .font: BookType.headline]
        navigation.largeTitleTextAttributes = [.foregroundColor: ink, .font: BookType.display]
        UINavigationBar.appearance().standardAppearance = navigation
        UINavigationBar.appearance().compactAppearance = navigation
        if #available(iOS 26.0, *) {
            // iOS 26：自定义不透明导航栏背景会在「大标题 ↔ 搜索」状态切换后把大标题压到背景层下
            // （FB20986869，Apple 建议减少自定义背景）。大标题所在的 scrollEdge 态改为透明背景，
            // 纸白由各页面 view 背景承接；滚动后的 standard/compact 态保留纸白不透明背景。
            let scrollEdge = UINavigationBarAppearance()
            scrollEdge.configureWithTransparentBackground()
            scrollEdge.titleTextAttributes = navigation.titleTextAttributes
            scrollEdge.largeTitleTextAttributes = navigation.largeTitleTextAttributes
            UINavigationBar.appearance().scrollEdgeAppearance = scrollEdge
            UINavigationBar.appearance().compactScrollEdgeAppearance = scrollEdge
        } else {
            UINavigationBar.appearance().scrollEdgeAppearance = navigation
        }
        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = paper
        for item in [tab.stackedLayoutAppearance, tab.inlineLayoutAppearance, tab.compactInlineLayoutAppearance] {
            item.normal.iconColor = ink3
            item.normal.titleTextAttributes = [.foregroundColor: ink3, .font: BookType.caption]
            item.selected.iconColor = ink
            item.selected.titleTextAttributes = [.foregroundColor: ink, .font: BookType.caption]
        }
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
        UITableView.appearance().backgroundColor = paper
        UITableViewCell.appearance().backgroundColor = paper
    }

    /// 列表分组头内容（笔记/对话共用）：封面缩略图 + 书名 + 计数。
    static func listGroupHeaderContent(
        title: String,
        countText: String,
        image: UIImage
    ) -> UIListContentConfiguration {
        var content = UIListContentConfiguration.subtitleCell()
        content.image = image
        content.imageProperties.maximumSize = CGSize(width: 22, height: 30)
        content.imageProperties.cornerRadius = 3
        content.text = title
        content.textProperties.font = BookType.sans(13, weight: .semibold, style: .subheadline)
        content.textProperties.color = ink
        content.textProperties.numberOfLines = 2
        content.secondaryText = countText
        content.secondaryTextProperties.font = BookType.caption
        content.secondaryTextProperties.color = ink3
        return content
    }

    /// 列表页逐 item 导航栏外观（iOS 26+）：自定义不透明背景会在「大标题 ↔ 搜索」状态切换后
    /// 盖住大标题（FB20986869）。大标题所在的 scrollEdge 态改用透明背景（纸白由页面自身提供），
    /// 滚动后的 standard/compact 态保留纸白不透明背景；旧系统沿用全局 appearance。
    @MainActor
    static func applyListPageNavigationAppearance(to item: UINavigationItem) {
        guard #available(iOS 26.0, *) else { return }
        let titleAttributes: [NSAttributedString.Key: Any] = [
            .foregroundColor: ink,
            .font: BookType.headline
        ]
        let largeTitleAttributes: [NSAttributedString.Key: Any] = [
            .foregroundColor: ink,
            .font: BookType.display
        ]
        let standard = UINavigationBarAppearance()
        standard.configureWithOpaqueBackground()
        standard.backgroundColor = paper
        standard.shadowColor = .clear
        standard.titleTextAttributes = titleAttributes
        standard.largeTitleTextAttributes = largeTitleAttributes
        let scrollEdge = UINavigationBarAppearance()
        scrollEdge.configureWithTransparentBackground()
        scrollEdge.titleTextAttributes = titleAttributes
        scrollEdge.largeTitleTextAttributes = largeTitleAttributes
        item.standardAppearance = standard
        item.compactAppearance = standard
        item.scrollEdgeAppearance = scrollEdge
        item.compactScrollEdgeAppearance = scrollEdge
    }

    // MARK: 标签与基础控件

    static func label(
        _ text: String?,
        size: CGFloat = 16,
        weight: UIFont.Weight = .regular,
        colour: UIColor = ink,
        style: UIFont.TextStyle = .body
    ) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = font(size, weight: weight, style: style)
        label.textColor = colour
        label.numberOfLines = 0
        label.adjustsFontForContentSizeCategory = true
        return label
    }

    static func label(_ text: String?, font: UIFont, colour: UIColor = ink) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = font
        label.textColor = colour
        label.numberOfLines = 0
        label.adjustsFontForContentSizeCategory = true
        return label
    }

    static func table(_ table: UITableView) {
        table.backgroundColor = paper
        table.separatorColor = line
        table.rowHeight = UITableView.automaticDimension
        table.estimatedRowHeight = 100
    }

    static func button(_ button: UIButton, title: String, symbol: String? = nil, filled: Bool = false) {
        var config = filled ? UIButton.Configuration.filled() : UIButton.Configuration.plain()
        config.title = title
        config.image = symbol.flatMap(UIImage.init(systemName:))
        config.imagePadding = 8
        config.baseForegroundColor = filled ? paper : lampInk
        config.baseBackgroundColor = ink
        config.cornerStyle = .medium
        // configuration 会覆盖 titleLabel.font；字体通过文字属性 transformer 生效。
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = BookType.subhead
            return outgoing
        }
        button.configuration = config
        button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    }

    /// 纸白表单：AI 设置等系统 UIViewController 表单页使用。
    static func formTable(_ table: UITableView) {
        table.backgroundColor = paper
        table.separatorColor = line
        table.separatorInset = UIEdgeInsets(top: 0, left: BookSpacing.screen, bottom: 0, right: BookSpacing.screen)
        table.rowHeight = UITableView.automaticDimension
        table.estimatedRowHeight = 56
        table.sectionHeaderTopPadding = 20
        table.contentInset = UIEdgeInsets(top: 0, left: 0, bottom: 24, right: 0)
    }

    static func formHeaderFooter(_ view: UIView) {
        guard let container = view as? UITableViewHeaderFooterView else { return }
        container.contentView.backgroundColor = paper
        container.textLabel?.font = BookType.caption
        container.textLabel?.textColor = ink3
        container.textLabel?.numberOfLines = 0
    }

    static func symbol(_ name: String, size: CGFloat, weight: UIImage.SymbolWeight = .regular) -> UIImage? {
        UIImage(systemName: name, withConfiguration: UIImage.SymbolConfiguration(pointSize: size, weight: weight))
    }

    static let brandMark: UIImage? = {
        guard let source = UIImage(named: "BrandIcon") else { return nil }
        let dimension = 64
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: dimension, height: dimension))
        let scaled = renderer.image { _ in
            source.draw(in: CGRect(x: 0, y: 0, width: dimension, height: dimension))
        }
        guard let image = scaled.cgImage else { return nil }
        let width = image.width, height = image.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        guard let context = CGContext(
            data: &pixels,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        for offset in stride(from: 0, to: pixels.count, by: 4) {
            let luminance = (Int(pixels[offset]) + Int(pixels[offset + 1]) + Int(pixels[offset + 2])) / 3
            pixels[offset] = 0
            pixels[offset + 1] = 0
            pixels[offset + 2] = 0
            pixels[offset + 3] = UInt8(clamping: 255 - luminance)
        }
        guard let provider = CGDataProvider(data: Data(pixels) as CFData),
              let mask = CGImage(
                width: width,
                height: height,
                bitsPerComponent: 8,
                bitsPerPixel: 32,
                bytesPerRow: width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                provider: provider,
                decode: nil,
                shouldInterpolate: true,
                intent: .defaultIntent
              ) else { return nil }
        return UIImage(cgImage: mask).withRenderingMode(.alwaysTemplate)
    }()
}

/// 九档字号：7 个界面角色 + 2 个阅读角色。
enum BookType {
    static func serif(_ size: CGFloat, weight: UIFont.Weight = .regular, style: UIFont.TextStyle = .body) -> UIFont {
        let name = weight.rawValue >= UIFont.Weight.semibold.rawValue ? "SongtiSC-Bold" : "SongtiSC-Regular"
        let base = UIFont(name: name, size: size) ?? UIFont.systemFont(ofSize: size, weight: weight)
        return UIFontMetrics(forTextStyle: style).scaledFont(for: base)
    }

    static func sans(_ size: CGFloat, weight: UIFont.Weight = .regular, style: UIFont.TextStyle = .body) -> UIFont {
        UIFontMetrics(forTextStyle: style).scaledFont(for: .systemFont(ofSize: size, weight: weight))
    }

    static var display: UIFont { serif(30, weight: .semibold, style: .largeTitle) }
    static var title: UIFont { serif(22, weight: .semibold, style: .title2) }
    static var headline: UIFont { serif(17, weight: .semibold, style: .headline) }
    static var body: UIFont { sans(15, weight: .regular, style: .body) }
    static var subhead: UIFont { sans(13, weight: .medium, style: .subheadline) }
    static var footnote: UIFont { sans(12, weight: .regular, style: .footnote) }
    static var caption: UIFont { sans(10.5, weight: .medium, style: .caption1) }
    static var quote: UIFont { serif(14.5, weight: .regular, style: .body) }
    static var reading: UIFont { BookDesign.readingFont(18.5) }
    static func reading(_ size: CGFloat) -> UIFont { BookDesign.readingFont(size) }
}

/// 4pt 网格与页面边距。
enum BookSpacing {
    static let screen: CGFloat = 20
    static let reading: CGFloat = 28
    static let xxs: CGFloat = 4
    static let xs: CGFloat = 8
    static let sm: CGFloat = 12
    static let md: CGFloat = 16
    static let lg: CGFloat = 24
    static let xl: CGFloat = 32
}

/// 列表行时间文案；复用 DateFormatter，避免每配置一个 cell 就新建。
enum BookDateFormat {
    private static let clock: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = .autoupdatingCurrent
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    private static let monthDay: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = .autoupdatingCurrent
        formatter.dateFormat = "M月d日"
        return formatter
    }()

    private static let monthDayTime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = .autoupdatingCurrent
        formatter.dateFormat = "M月d日 HH:mm"
        return formatter
    }()

    /// 笔记行：今天 HH:mm / 昨天 HH:mm / M月d日
    static func recordTime(_ date: Date) -> String {
        let calendar = Calendar.autoupdatingCurrent
        if calendar.isDateInToday(date) { return "今天 " + clock.string(from: date) }
        if calendar.isDateInYesterday(date) { return "昨天 " + clock.string(from: date) }
        return monthDay.string(from: date)
    }

    /// 对话行：今天 HH:mm / 昨天 HH:mm / M月d日 HH:mm
    static func conversationTime(_ date: Date) -> String {
        let calendar = Calendar.autoupdatingCurrent
        if calendar.isDateInToday(date) { return "今天 " + clock.string(from: date) }
        if calendar.isDateInYesterday(date) { return "昨天 " + clock.string(from: date) }
        return monthDayTime.string(from: date)
    }
}

/// 4 档圆角 + 胶囊。
enum BookRadius {
    static let cover: CGFloat = 4
    static let field: CGFloat = 10
    static let card: CGFloat = 14
    static let sheet: CGFloat = 22
    static let pill: CGFloat = 999
}

/// 两档阴影；不与描边同时使用。
enum BookElevation {
    static func floating(_ view: UIView) {
        view.layer.shadowColor = UIColor.black.cgColor
        view.layer.shadowOpacity = 0.26
        view.layer.shadowRadius = 34
        view.layer.shadowOffset = CGSize(width: 0, height: 14)
    }
}

/// Four destinations rendered by the app-owned, flat bottom bar.
enum RootDestination: Int, CaseIterable {
    case library, notes, conversations, profile

    var title: String {
        switch self {
        case .library: return "书架"
        case .notes: return "笔记"
        case .conversations: return "对话"
        case .profile: return "我的"
        }
    }

    var symbol: String {
        switch self {
        case .library: return "books.vertical"
        case .notes: return "square.and.pencil"
        case .conversations: return "bubble.left.and.bubble.right"
        case .profile: return "person.crop.circle"
        }
    }

    /// 选中态优先填充；没有 fill 变体的符号回退到线性符号 + 墨色。
    var selectedSymbol: String {
        switch self {
        case .library: return "books.vertical.fill"
        case .notes: return "square.and.pencil"
        case .conversations: return "bubble.left.and.bubble.right.fill"
        case .profile: return "person.crop.circle.fill"
        }
    }

    var accessibilityIdentifier: String {
        switch self {
        case .library: return "tab-library"
        case .notes: return "tab-notes"
        case .conversations: return "tab-conversations"
        case .profile: return "tab-profile"
        }
    }
}

/// The top-level shell owns the persistent flat navigation bar and swaps the
/// four navigation stacks without changing their state.
final class RootTabController: UIViewController {
    let viewControllers: [UIViewController]
    private let content = UIView()
    let tabBar = RootTabBar()
    private(set) var selectedIndex = 0
    private var selectedController: UIViewController?

    init(viewControllers: [UIViewController]) {
        precondition(viewControllers.count == RootDestination.allCases.count)
        self.viewControllers = viewControllers
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func select(_ index: Int) {
        guard viewControllers.indices.contains(index) else { return }
        guard isViewLoaded else {
            selectedIndex = index
            return
        }
        guard index != selectedIndex || selectedController == nil else { return }
        removeSelectedController()
        selectedIndex = index
        installSelectedController()
        tabBar.setSelectedIndex(selectedIndex)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = BookDesign.paper
        view.accessibilityIdentifier = "app-tabs"

        content.translatesAutoresizingMaskIntoConstraints = false
        tabBar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(content)
        view.addSubview(tabBar)

        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: view.topAnchor),
            content.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            content.bottomAnchor.constraint(equalTo: tabBar.topAnchor),
            tabBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            tabBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            tabBar.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            tabBar.heightAnchor.constraint(equalToConstant: 56)
        ])

        tabBar.onSelect = { [weak self] index in self?.select(index) }
        installSelectedController()
    }

    private func installSelectedController() {
        let controller = viewControllers[selectedIndex]
        selectedController = controller
        if view.window != nil {
            controller.beginAppearanceTransition(true, animated: false)
        }
        addChild(controller)
        controller.view.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(controller.view)
        NSLayoutConstraint.activate([
            controller.view.topAnchor.constraint(equalTo: content.topAnchor),
            controller.view.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            controller.view.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            controller.view.bottomAnchor.constraint(equalTo: content.bottomAnchor)
        ])
        controller.didMove(toParent: self)
        if view.window != nil {
            controller.endAppearanceTransition()
        }
    }

    private func removeSelectedController() {
        guard let controller = selectedController else { return }
        selectedController = nil
        controller.willMove(toParent: nil)
        if view.window != nil {
            controller.beginAppearanceTransition(false, animated: false)
        }
        controller.view.removeFromSuperview()
        if view.window != nil {
            controller.endAppearanceTransition()
        }
        controller.removeFromParent()
    }
}

final class RootTabBar: UIView {
    var onSelect: ((Int) -> Void)?
    private let line = UIView()
    private let buttons: [RootTabButton]

    override init(frame: CGRect) {
        buttons = RootDestination.allCases.map { RootTabButton(destination: $0) }
        super.init(frame: frame)
        backgroundColor = BookDesign.paper
        accessibilityIdentifier = "main-tabs"

        line.backgroundColor = BookDesign.line
        line.translatesAutoresizingMaskIntoConstraints = false
        addSubview(line)

        let row = UIStackView(arrangedSubviews: buttons)
        row.axis = .horizontal
        row.distribution = .fillEqually
        row.alignment = .fill
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            line.topAnchor.constraint(equalTo: topAnchor),
            line.leadingAnchor.constraint(equalTo: leadingAnchor),
            line.trailingAnchor.constraint(equalTo: trailingAnchor),
            line.heightAnchor.constraint(equalToConstant: 1),
            row.topAnchor.constraint(equalTo: topAnchor),
            row.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 6),
            row.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -6),
            row.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])

        for (index, button) in buttons.enumerated() {
            button.tag = index
            button.addAction(UIAction { [weak self] _ in self?.onSelect?(index) }, for: .touchUpInside)
        }
        setSelectedIndex(0)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func setSelectedIndex(_ index: Int) {
        for (buttonIndex, button) in buttons.enumerated() {
            button.isSelected = buttonIndex == index
        }
    }
}

private final class RootTabButton: UIControl {
    private let icon = UIImageView()
    private let label = BookDesign.label(nil, font: BookType.caption, colour: BookDesign.ink3)
    private let destination: RootDestination

    init(destination: RootDestination) {
        self.destination = destination
        super.init(frame: .zero)
        isAccessibilityElement = true
        accessibilityTraits = .button
        accessibilityLabel = destination.title
        accessibilityIdentifier = destination.accessibilityIdentifier

        icon.image = BookDesign.symbol(destination.symbol, size: 22)
        icon.contentMode = .scaleAspectFit
        icon.tintColor = BookDesign.ink3
        icon.isAccessibilityElement = false
        label.text = destination.title
        label.textAlignment = .center
        label.isAccessibilityElement = false

        let stack = UIStackView(arrangedSubviews: [icon, label])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 3
        stack.isUserInteractionEnabled = false
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 22),
            icon.heightAnchor.constraint(equalToConstant: 22)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override var isSelected: Bool {
        didSet {
            let symbol = isSelected ? destination.selectedSymbol : destination.symbol
            icon.image = BookDesign.symbol(symbol, size: 22)
                ?? BookDesign.symbol(destination.symbol, size: 22)
            icon.tintColor = isSelected ? BookDesign.ink : BookDesign.ink3
            label.textColor = isSelected ? BookDesign.ink : BookDesign.ink3
            accessibilityTraits = isSelected ? [.button, .selected] : .button
        }
    }

    override var isHighlighted: Bool {
        didSet { alpha = isHighlighted ? 0.72 : 1 }
    }
}

final class CircularIconButton: UIButton {
    enum Style { case ghost, solid, fill }

    private let baseTint: UIColor

    init(symbol: String, label: String, style: Style = .ghost, identifier: String = "library-import") {
        switch style {
        case .ghost: baseTint = BookDesign.ink2
        case .solid: baseTint = BookDesign.paper
        case .fill: baseTint = BookDesign.ink
        }
        super.init(frame: .zero)
        switch style {
        case .ghost:
            backgroundColor = .clear
        case .solid:
            backgroundColor = BookDesign.ink
        case .fill:
            backgroundColor = BookDesign.paperDeep
        }
        tintColor = baseTint
        layer.cornerRadius = 18
        let iconSize: CGFloat
        switch style {
        case .solid: iconSize = 17
        case .ghost, .fill: iconSize = 19
        }
        var config = UIButton.Configuration.plain()
        config.image = BookDesign.symbol(symbol, size: iconSize, weight: .medium)
        config.baseForegroundColor = baseTint
        config.contentInsets = .zero
        configuration = config
        accessibilityLabel = label
        accessibilityIdentifier = identifier
        widthAnchor.constraint(equalToConstant: 36).isActive = true
        heightAnchor.constraint(equalToConstant: 36).isActive = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override var isHighlighted: Bool {
        didSet { alpha = isHighlighted ? 0.72 : 1 }
    }

    /// 视觉 36pt，命中区 44pt。
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        bounds.insetBy(dx: -4, dy: -4).contains(point)
    }
}

/// 无原封面时的字体书衣：四组低饱和纸色 + 宋体书名 + 极细内框 + 底部灯点。
final class BookCoverView: UIView {
    private let image = UIImageView()
    private let name = UILabel()
    private let author = UILabel()
    private let rule = UIView()
    private let dot = UIView()
    private let inset = UIView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.cornerRadius = BookRadius.cover
        clipsToBounds = true

        image.contentMode = .scaleAspectFill
        image.clipsToBounds = true

        name.font = BookType.serif(19, weight: .semibold)
        name.textAlignment = .center
        name.numberOfLines = 2
        name.lineBreakMode = .byCharWrapping
        name.adjustsFontForContentSizeCategory = false
        author.font = BookType.sans(8, weight: .medium, style: .caption2)
        author.textAlignment = .center
        author.numberOfLines = 1
        author.adjustsFontForContentSizeCategory = false

        dot.layer.cornerRadius = 2
        inset.layer.borderWidth = 1
        inset.isUserInteractionEnabled = false
        inset.layer.cornerRadius = 2

        for child in [image, inset, name, rule, author, dot] {
            child.translatesAutoresizingMaskIntoConstraints = false
            addSubview(child)
        }
        NSLayoutConstraint.activate([
            image.topAnchor.constraint(equalTo: topAnchor),
            image.bottomAnchor.constraint(equalTo: bottomAnchor),
            image.leadingAnchor.constraint(equalTo: leadingAnchor),
            image.trailingAnchor.constraint(equalTo: trailingAnchor),
            inset.topAnchor.constraint(equalTo: topAnchor, constant: 6),
            inset.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 6),
            inset.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -6),
            inset.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -6),
            name.centerXAnchor.constraint(equalTo: centerXAnchor),
            name.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -6),
            name.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 10),
            name.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -10),
            rule.centerXAnchor.constraint(equalTo: centerXAnchor),
            rule.topAnchor.constraint(equalTo: name.bottomAnchor, constant: 7),
            rule.widthAnchor.constraint(equalToConstant: 14),
            rule.heightAnchor.constraint(equalToConstant: 1),
            author.centerXAnchor.constraint(equalTo: centerXAnchor),
            author.topAnchor.constraint(equalTo: rule.bottomAnchor, constant: 7),
            author.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 8),
            author.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -8),
            dot.centerXAnchor.constraint(equalTo: centerXAnchor),
            dot.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -9),
            dot.widthAnchor.constraint(equalToConstant: 4),
            dot.heightAnchor.constraint(equalToConstant: 4)
        ])
        isAccessibilityElement = false
        accessibilityElementsHidden = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func configure(_ book: Book, image: UIImage?, compact: Bool = false) {
        name.font = BookType.serif(compact ? 11 : 19, weight: .semibold)
        author.font = BookType.sans(compact ? 6.5 : 8, weight: .medium, style: .caption2)
        name.text = book.title
        author.text = book.author
        let style = palette(for: book.title)
        backgroundColor = style.background
        name.textColor = style.ink
        author.textColor = style.ink.withAlphaComponent(0.78)
        rule.backgroundColor = style.ink.withAlphaComponent(0.4)
        dot.backgroundColor = style.ink.withAlphaComponent(0.45)
        inset.layer.borderColor = style.ink.withAlphaComponent(0.18).cgColor

        self.image.image = image
        self.image.isHidden = image == nil
        for child in [name, rule, author, dot, inset] as [UIView] { child.isHidden = image != nil }
        isAccessibilityElement = false
        accessibilityElementsHidden = true
    }

    private struct Palette {
        let background: UIColor
        let ink: UIColor
    }

    private func palette(for title: String) -> Palette {
        let groups: [Palette] = [
            Palette(background: BookDesign.rgb(0xF0E5CE), ink: BookDesign.rgb(0x3B332A)),
            Palette(background: BookDesign.rgb(0x38483F), ink: BookDesign.rgb(0xF1EAD9)),
            Palette(background: BookDesign.rgb(0x8F5336), ink: BookDesign.rgb(0xF7EBDF)),
            Palette(background: BookDesign.rgb(0x3A4653), ink: BookDesign.rgb(0xEFF0E8))
        ]
        let index = title.utf8.reduce(0) { ($0 + Int($1)) % groups.count }
        return groups[index]
    }
}

/// Bounded, memory-only thumbnails; source books and catalogue format are unchanged.
@MainActor
final class BookCoverStore {
    private let cache = NSCache<NSString, UIImage>()
    private var absent: Set<String> = []
    init() { cache.totalCostLimit = 24 * 1024 * 1024; cache.countLimit = 40 }
    func image(for book: Book, library: LibraryStore) async -> UIImage? {
        if let image = cache.object(forKey: book.id as NSString) { return image }
        guard !absent.contains(book.id), library.sourceAvailable(for: book.id) else { return nil }
        do {
            let publication = try await library.open(book)
            let image = try await publication.coverFitting(maxSize: CGSize(width: 480, height: 720)).get()
            if let image { cache.setObject(image, forKey: book.id as NSString, cost: Int(image.size.width * image.size.height * 4)) }
            else { absent.insert(book.id) }
            return image
        } catch { return nil }
    }
}

/// 列表分组头使用的小封面：优先真实 EPUB 封面，无封面时回退到书名首字纸色块。
@MainActor
final class BookThumbnailStore {
    private let cache = NSCache<NSString, UIImage>()

    func placeholder(for title: String) -> UIImage {
        let key = "placeholder-\(title)" as NSString
        if let cached = cache.object(forKey: key) { return cached }
        let image = Self.renderPlaceholder(for: title)
        cache.setObject(image, forKey: key)
        return image
    }

    func image(for book: Book, covers: BookCoverStore, library: LibraryStore) async -> UIImage {
        if let cached = cache.object(forKey: book.id as NSString) { return cached }
        guard let image = await covers.image(for: book, library: library) else {
            return placeholder(for: book.title)
        }
        cache.setObject(image, forKey: book.id as NSString)
        return image
    }

    private static func renderPlaceholder(for title: String) -> UIImage {
        let colours = [0x38483F, 0x8F5336, 0x3A4653, 0x6D5A3A]
        let index = title.utf8.reduce(0) { ($0 + Int($1)) % colours.count }
        let size = CGSize(width: 36, height: 48)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { _ in
            BookDesign.rgb(colours[index]).setFill()
            UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 4).fill()
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont(name: "SongtiSC-Semibold", size: 15) ?? UIFont.systemFont(ofSize: 15, weight: .semibold),
                .foregroundColor: BookDesign.paper
            ]
            let text = NSAttributedString(string: String(title.prefix(1)), attributes: attributes)
            let measured = text.size()
            text.draw(at: CGPoint(x: (size.width - measured.width) / 2, y: (size.height - measured.height) / 2))
        }
    }
}

/// 列表页空态配置：沿用纸白令牌与既有操作标题。
@available(iOS 17.0, *)
@MainActor
enum BookContentUnavailable {
    static func configuration(
        title: String,
        detail: String,
        symbol: String,
        actionTitle: String,
        action: @escaping () -> Void
    ) -> UIContentUnavailableConfiguration {
        var configuration = UIContentUnavailableConfiguration.empty()
        configuration.image = BookDesign.symbol(symbol, size: 44, weight: .light)
        configuration.imageProperties.tintColor = BookDesign.secondary
        configuration.text = title
        configuration.textProperties.font = BookType.serif(24, weight: .semibold, style: .title2)
        configuration.textProperties.color = BookDesign.ink
        configuration.secondaryText = detail
        configuration.secondaryTextProperties.font = BookType.subhead
        configuration.secondaryTextProperties.color = BookDesign.ink2
        var button = configuration.button
        button.title = actionTitle
        button.baseForegroundColor = BookDesign.paper
        button.baseBackgroundColor = BookDesign.ink
        button.cornerStyle = .capsule
        button.contentInsets = NSDirectionalEdgeInsets(top: 11, leading: 22, bottom: 11, trailing: 22)
        configuration.button = button
        configuration.buttonProperties.primaryAction = UIAction { _ in action() }
        return configuration
    }
}

/// 纸与灯风格的弹层动作；与 UIAlertAction 的调用形态一致。
final class BookAlertAction {
    enum Style { case `default`, cancel, destructive }
    let title: String?
    let style: Style
    let handler: ((BookAlertAction) -> Void)?

    init(title: String?, style: Style, handler: ((BookAlertAction) -> Void)? = nil) {
        self.title = title
        self.style = style
        self.handler = handler
    }
}

/// 纸与灯风格的轻量弹层：替代系统 UIAlertController 的 alert / actionSheet。
@MainActor
final class BookAlertController: UIViewController {
    enum Style { case alert, actionSheet }

    /// 兼容旧代码里的 popover 配置；自定义弹层忽略这些值。
    final class Popover {
        var sourceView: UIView?
        var sourceRect: CGRect = .zero
        var barButtonItem: UIBarButtonItem?
    }

    let bookPopover = Popover()

    private let alertTitle: String?
    private let alertMessage: String?
    private let alertStyle: Style
    private var actions: [BookAlertAction] = []
    private let dim = UIView()
    private let card = UIView()
    private(set) var textFields: [UITextField]?

    init(title: String?, message: String?, preferredStyle: Style) {
        self.alertTitle = title
        self.alertMessage = message
        self.alertStyle = preferredStyle
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .overFullScreen
        modalTransitionStyle = .crossDissolve
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func addAction(_ action: BookAlertAction) {
        actions.append(action)
    }

    func addTextField(configurationHandler: ((UITextField) -> Void)? = nil) {
        let field = UITextField()
        field.font = BookType.body
        field.textColor = BookDesign.ink
        field.backgroundColor = BookDesign.paperDeep
        field.layer.cornerRadius = BookRadius.field
        field.borderStyle = .none
        field.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 10, height: 1))
        field.leftViewMode = .always
        field.rightView = UIView(frame: CGRect(x: 0, y: 0, width: 10, height: 1))
        field.rightViewMode = .always
        field.heightAnchor.constraint(equalToConstant: 40).isActive = true
        configurationHandler?(field)
        if textFields == nil { textFields = [] }
        textFields?.append(field)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.accessibilityViewIsModal = true
        view.accessibilityIdentifier = "book-dialog"
        dim.backgroundColor = UIColor.black.withAlphaComponent(0.34)
        dim.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(dim)
        NSLayoutConstraint.activate([
            dim.topAnchor.constraint(equalTo: view.topAnchor),
            dim.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            dim.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            dim.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        let tap = UITapGestureRecognizer(target: self, action: #selector(backgroundTapped))
        dim.addGestureRecognizer(tap)

        card.backgroundColor = BookDesign.paper
        card.layer.cornerRadius = BookRadius.sheet
        card.layer.cornerCurve = .continuous
        BookElevation.floating(card)
        card.translatesAutoresizingMaskIntoConstraints = false
        card.accessibilityIdentifier = alertTitle ?? "book-dialog"
        view.addSubview(card)
        buildCard()

        switch alertStyle {
        case .alert:
            NSLayoutConstraint.activate([
                card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
                card.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
                card.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
                card.widthAnchor.constraint(lessThanOrEqualToConstant: 320)
            ])
            let preferred = card.widthAnchor.constraint(equalToConstant: 320)
            preferred.priority = .defaultHigh
            preferred.isActive = true
        case .actionSheet:
            NSLayoutConstraint.activate([
                card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
                card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
                card.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8)
            ])
        }
    }

    private func buildCard() {
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 0
        stack.isLayoutMarginsRelativeArrangement = true
        stack.layoutMargins = UIEdgeInsets(top: 20, left: 20, bottom: 16, right: 20)
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor)
        ])

        if let alertTitle {
            let title = BookDesign.label(alertTitle, font: BookType.serif(17, weight: .semibold, style: .headline))
            title.textAlignment = alertStyle == .alert ? .center : .left
            stack.addArrangedSubview(title)
        }
        if let alertMessage, !alertMessage.isEmpty {
            let message = BookDesign.label(alertMessage, font: BookType.sans(13, weight: .regular, style: .footnote), colour: BookDesign.ink2)
            message.textAlignment = alertStyle == .alert ? .center : .left
            message.numberOfLines = 0
            if let last = stack.arrangedSubviews.last { stack.setCustomSpacing(6, after: last) }
            stack.addArrangedSubview(message)
        }
        if let fields = textFields, !fields.isEmpty {
            let fieldStack = UIStackView(arrangedSubviews: fields)
            fieldStack.axis = .vertical
            fieldStack.spacing = 8
            if let last = stack.arrangedSubviews.last { stack.setCustomSpacing(14, after: last) }
            stack.addArrangedSubview(fieldStack)
        }

        let cancelActions = actions.filter { $0.style == .cancel }
        let mainActions = actions.filter { $0.style != .cancel }

        let actionStack = UIStackView()
        actionStack.axis = .vertical
        actionStack.spacing = alertStyle == .actionSheet ? 0 : 8
        if let last = stack.arrangedSubviews.last { stack.setCustomSpacing(18, after: last) }
        stack.addArrangedSubview(actionStack)

        var primaryUsed = false
        for action in mainActions {
            let isPrimary = alertStyle == .alert && action.style != .destructive && !primaryUsed
            if isPrimary { primaryUsed = true }
            actionStack.addArrangedSubview(makeButton(action, primary: isPrimary))
            if alertStyle == .actionSheet, let last = mainActions.last, action !== last {
                let line = UIView()
                line.backgroundColor = BookDesign.line
                line.heightAnchor.constraint(equalToConstant: 1).isActive = true
                actionStack.addArrangedSubview(line)
            }
        }
        if let cancel = cancelActions.first {
            stack.setCustomSpacing(alertStyle == .alert ? 8 : 10, after: actionStack)
            stack.addArrangedSubview(makeButton(cancel, primary: false))
        }
    }

    private func makeButton(_ action: BookAlertAction, primary: Bool) -> UIButton {
        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.plain()
        configuration.title = action.title
        let isCancel = action.style == .cancel
        let isDestructive = action.style == .destructive
        if alertStyle == .alert {
            configuration.baseForegroundColor = isDestructive ? BookDesign.error : (primary ? BookDesign.paper : BookDesign.ink)
            configuration.background.backgroundColor = isDestructive ? BookDesign.errorWash : (primary ? BookDesign.ink : BookDesign.paperDeep)
            configuration.background.cornerRadius = 12
        } else {
            configuration.baseForegroundColor = isCancel ? BookDesign.ink2 : (isDestructive ? BookDesign.error : BookDesign.ink)
            configuration.background.backgroundColor = isCancel ? BookDesign.paperDeep : .clear
            configuration.background.cornerRadius = isCancel ? 12 : 0
        }
        configuration.contentInsets = NSDirectionalEdgeInsets(
            top: alertStyle == .alert ? 11 : 14,
            leading: 16,
            bottom: alertStyle == .alert ? 11 : 14,
            trailing: 16
        )
        configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = BookType.sans(14, weight: .medium, style: .subheadline)
            return outgoing
        }
        button.configuration = configuration
        if alertStyle == .alert {
            button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        }
        button.addAction(UIAction { [weak self] _ in self?.trigger(action) }, for: .touchUpInside)
        return button
    }

    private func trigger(_ action: BookAlertAction) {
        let handler = action.handler
        let animate = !UIAccessibility.isReduceMotionEnabled
        UIView.animate(withDuration: animate ? 0.16 : 0, animations: {
            self.dim.alpha = 0
            self.card.alpha = 0
        }) { _ in
            self.dismiss(animated: false) { handler?(action) }
        }
    }

    @objc private func backgroundTapped() {
        guard alertStyle == .actionSheet else { return }
        if let cancel = actions.first(where: { $0.style == .cancel }) {
            trigger(cancel)
        }
    }
}

// MARK: 高亮颜色令牌

extension HighlightColor {
    /// 阅读器 decoration 背景色；旧数据 nil 已由 BookNote.highlightColor 归一为黄。
    var tint: UIColor {
        switch self {
        case .yellow: return BookDesign.highlightYellow
        case .green: return BookDesign.highlightGreen
        case .blue: return BookDesign.highlightBlue
        case .rose: return BookDesign.highlightRose
        }
    }
}
