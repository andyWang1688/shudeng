import UIKit
import ReadiumShared

/// Shared paper, ink and lamp colours. All values adapt without changing system text size.
enum BookDesign {
    static let paper = colour(0xFCFBF8, 0x20231F)
    static let surface = colour(0xFFFFFF, 0x292D27)
    static let wash = colour(0xF2F0E9, 0x31362E)
    static let ink = colour(0x282B26, 0xF0F1E9)
    static let secondary = colour(0x64675F, 0xC0C4B8)
    static let muted = colour(0x696C63, 0xA8AD9F)
    static let lamp = colour(0x8A590D, 0xEDC579)
    static let accent = lamp
    static let accentWash = colour(0xF5E9CC, 0x403725)
    static let selection = colour(0xF4E3AC, 0x5B4D2D)
    static let glow = accentWash
    static let line = colour(0xE6E3DA, 0x3D4338)
    static let error = colour(0xA13C30, 0xF2AEA2)
    static let errorWash = colour(0xFAEBE7, 0x472E28)
    private static func colour(_ light: Int, _ dark: Int) -> UIColor {
        UIColor { rgb($0.userInterfaceStyle == .dark ? dark : light) }
    }
    static func rgb(_ value: Int) -> UIColor {
        UIColor(red: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255,
                blue: CGFloat(value & 255) / 255, alpha: 1)
    }
    static func font(_ size: CGFloat, weight: UIFont.Weight = .regular, style: UIFont.TextStyle = .body) -> UIFont {
        UIFontMetrics(forTextStyle: style).scaledFont(for: .systemFont(ofSize: size, weight: weight))
    }
    static func readingFont(_ size: CGFloat = 17) -> UIFont {
        UIFontMetrics(forTextStyle: .body).scaledFont(for: UIFont(name: "SongtiSC-Regular", size: size) ?? .systemFont(ofSize: size))
    }
    static func install() {
        UIView.appearance().tintColor = lamp
        let navigation = UINavigationBarAppearance()
        navigation.configureWithOpaqueBackground(); navigation.backgroundColor = paper; navigation.shadowColor = .clear
        navigation.titleTextAttributes = [.foregroundColor: ink, .font: font(17, weight: .semibold)]
        navigation.largeTitleTextAttributes = [.foregroundColor: ink, .font: font(31, weight: .semibold, style: .largeTitle)]
        UINavigationBar.appearance().standardAppearance = navigation
        UINavigationBar.appearance().scrollEdgeAppearance = navigation
        UINavigationBar.appearance().compactAppearance = navigation
        let tab = UITabBarAppearance(); tab.configureWithOpaqueBackground(); tab.backgroundColor = paper
        for item in [tab.stackedLayoutAppearance, tab.inlineLayoutAppearance, tab.compactInlineLayoutAppearance] {
            item.normal.iconColor = secondary; item.normal.titleTextAttributes = [.foregroundColor: secondary]
            item.selected.iconColor = lamp; item.selected.titleTextAttributes = [.foregroundColor: lamp]
        }
        UITabBar.appearance().standardAppearance = tab; UITabBar.appearance().scrollEdgeAppearance = tab
        UITableView.appearance().backgroundColor = paper
        UITableViewCell.appearance().backgroundColor = paper
    }
    static func label(
        _ text: String?,
        size: CGFloat = 16,
        weight: UIFont.Weight = .regular,
        colour: UIColor = ink,
        style: UIFont.TextStyle = .body
    ) -> UILabel {
        let label = UILabel(); label.text = text; label.font = font(size, weight: weight, style: style)
        label.textColor = colour; label.numberOfLines = 0; label.adjustsFontForContentSizeCategory = true
        return label
    }
    static func table(_ table: UITableView) {
        table.backgroundColor = paper; table.separatorColor = line
        table.rowHeight = UITableView.automaticDimension; table.estimatedRowHeight = 100
    }
    static func button(_ button: UIButton, title: String, symbol: String? = nil, filled: Bool = false) {
        var config = filled ? UIButton.Configuration.filled() : UIButton.Configuration.plain()
        config.title = title; config.image = symbol.flatMap(UIImage.init(systemName:)); config.imagePadding = 8
        config.baseForegroundColor = filled ? paper : lamp; config.baseBackgroundColor = ink
        config.cornerStyle = .medium
        button.configuration = config
        button.titleLabel?.font = font(15, weight: .medium); button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    }
    static func symbol(_ name: String, size: CGFloat, weight: UIImage.SymbolWeight = .regular) -> UIImage? {
        UIImage(
            systemName: name,
            withConfiguration: UIImage.SymbolConfiguration(pointSize: size, weight: weight)
        )
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
            tabBar.heightAnchor.constraint(equalToConstant: 81)
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
            row.topAnchor.constraint(equalTo: topAnchor, constant: 8),
            row.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            row.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            row.heightAnchor.constraint(equalToConstant: 50)
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
    private let marker = UIView()
    private let icon = UIImageView()
    private let label = BookDesign.label(nil, size: 10, weight: .medium, colour: BookDesign.secondary)
    private let destination: RootDestination

    init(destination: RootDestination) {
        self.destination = destination
        super.init(frame: .zero)
        isAccessibilityElement = true
        accessibilityTraits = .button
        accessibilityLabel = destination.title
        accessibilityIdentifier = destination.accessibilityIdentifier

        marker.backgroundColor = BookDesign.accent
        marker.layer.cornerRadius = 2
        marker.translatesAutoresizingMaskIntoConstraints = false
        addSubview(marker)

        icon.image = BookDesign.symbol(destination.symbol, size: 23)
        icon.contentMode = .scaleAspectFit
        icon.tintColor = BookDesign.secondary
        icon.isAccessibilityElement = false
        label.text = destination.title
        label.textAlignment = .center
        label.isAccessibilityElement = false

        let stack = UIStackView(arrangedSubviews: [icon, label])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 4
        stack.isUserInteractionEnabled = false
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            marker.topAnchor.constraint(equalTo: topAnchor),
            marker.centerXAnchor.constraint(equalTo: centerXAnchor),
            marker.widthAnchor.constraint(equalToConstant: 19),
            marker.heightAnchor.constraint(equalToConstant: 3),
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 8),
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            icon.widthAnchor.constraint(equalToConstant: 23),
            icon.heightAnchor.constraint(equalToConstant: 23)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override var isSelected: Bool {
        didSet {
            marker.isHidden = !isSelected
            icon.tintColor = isSelected ? BookDesign.ink : BookDesign.secondary
            label.textColor = isSelected ? BookDesign.ink : BookDesign.secondary
            accessibilityTraits = isSelected ? [.button, .selected] : .button
        }
    }

    override var isHighlighted: Bool {
        didSet { alpha = isHighlighted ? 0.72 : 1 }
    }
}

final class BrandRow: UIView {
    private let mark = UIImageView()

    init(motto: String = "一盏照书的灯") {
        super.init(frame: .zero)
        accessibilityIdentifier = "brand-row"
        mark.image = BookDesign.brandMark
        mark.tintColor = BookDesign.ink
        mark.contentMode = .scaleAspectFit
        mark.isAccessibilityElement = false
        let wordmark = BookDesign.label("书灯", size: 21, weight: .semibold)
        wordmark.accessibilityIdentifier = "brand-wordmark"
        let identity = UIStackView(arrangedSubviews: [mark, wordmark])
        identity.axis = .horizontal
        identity.alignment = .center
        identity.spacing = 8
        let quiet = BookDesign.label(motto, size: 12, colour: BookDesign.muted)
        quiet.textAlignment = .right
        quiet.accessibilityIdentifier = "brand-motto"
        let row = UIStackView(arrangedSubviews: [identity, UIView(), quiet])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 12
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            mark.widthAnchor.constraint(equalToConstant: 25),
            mark.heightAnchor.constraint(equalToConstant: 25),
            row.topAnchor.constraint(equalTo: topAnchor, constant: 9),
            row.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -10),
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.trailingAnchor.constraint(equalTo: trailingAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}

final class CircularIconButton: UIButton {
    init(symbol: String, label: String) {
        super.init(frame: .zero)
        backgroundColor = BookDesign.wash
        layer.cornerRadius = 22
        setImage(BookDesign.symbol(symbol, size: 20), for: .normal)
        tintColor = BookDesign.ink
        accessibilityLabel = label
        accessibilityIdentifier = "library-import"
        widthAnchor.constraint(equalToConstant: 44).isActive = true
        heightAnchor.constraint(equalToConstant: 44).isActive = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override var isHighlighted: Bool {
        didSet { alpha = isHighlighted ? 0.72 : 1 }
    }
}

/// Original EPUB cover, with a title-only fallback (never a made-up publisher cover).
final class BookCoverView: UIView {
    private let image = UIImageView()
    private let name = BookDesign.label(nil, size: 23, weight: .medium)
    private let author = BookDesign.label(nil, size: 11)
    private let imprint = BookDesign.label("书 灯 · 藏 书", size: 9)
    private let type = UIStackView()
    private let frameLine = UIView()
    private var typeTop: NSLayoutConstraint!
    private var typeLeading: NSLayoutConstraint!
    private var typeTrailing: NSLayoutConstraint!
    private var typeBottom: NSLayoutConstraint!
    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.cornerRadius = 5; clipsToBounds = true
        image.contentMode = .scaleAspectFill; image.clipsToBounds = true
        name.font = BookDesign.readingFont(23)
        for label in [name, author, imprint] { label.textColor = BookDesign.rgb(0xF5EEDC) }
        name.lineBreakMode = .byCharWrapping
        for label in [name, author, imprint] {
            label.adjustsFontForContentSizeCategory = false
        }
        type.addArrangedSubview(name)
        type.addArrangedSubview(author)
        type.addArrangedSubview(UIView())
        type.addArrangedSubview(imprint)
        type.axis = .vertical
        type.spacing = 10
        let spine = UIView(); spine.backgroundColor = UIColor.black.withAlphaComponent(0.12)
        frameLine.layer.borderWidth = 1
        frameLine.isUserInteractionEnabled = false
        for child in [frameLine, type, image, spine] { child.translatesAutoresizingMaskIntoConstraints = false; addSubview(child) }
        typeTop = type.topAnchor.constraint(equalTo: topAnchor, constant: 20)
        typeLeading = type.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 17)
        typeTrailing = type.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12)
        typeBottom = type.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -16)
        NSLayoutConstraint.activate([
            typeTop, typeLeading, typeTrailing, typeBottom,
            image.topAnchor.constraint(equalTo: topAnchor), image.bottomAnchor.constraint(equalTo: bottomAnchor),
            image.leadingAnchor.constraint(equalTo: leadingAnchor), image.trailingAnchor.constraint(equalTo: trailingAnchor),
            frameLine.topAnchor.constraint(equalTo: topAnchor, constant: 9),
            frameLine.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 9),
            frameLine.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -9),
            frameLine.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -9),
            spine.topAnchor.constraint(equalTo: topAnchor), spine.bottomAnchor.constraint(equalTo: bottomAnchor),
            spine.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 5), spine.widthAnchor.constraint(equalToConstant: 2)
        ])
        isAccessibilityElement = false; accessibilityElementsHidden = true
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    func configure(_ book: Book, image: UIImage?, compact: Bool = false) {
        let style: (background: Int, ink: Int, titleSize: CGFloat, framed: Bool)
        switch book.title {
        case "红楼梦":
            style = (0xE4DBBA, 0x493D28, compact ? 21 : 30, true)
        case "瓦尔登湖":
            style = (0x3F5148, 0xF4F0DB, compact ? 19 : 27, false)
        case "论语":
            style = (0xC4B7AA, 0x3B302C, compact ? 19 : 28, false)
        default:
            let palette = [0x565D4A, 0x79513E, 0x4E626B, 0x75634C]
            let index = book.id.utf8.reduce(0) { ($0 + Int($1)) % palette.count }
            style = (palette[index], 0xF5EEDC, compact ? 17 : 23, false)
        }
        backgroundColor = BookDesign.rgb(style.background)
        let ink = BookDesign.rgb(style.ink)
        name.text = book.title
        author.text = book.author
        for label in [name, author, imprint] { label.textColor = ink }
        frameLine.layer.borderColor = ink.withAlphaComponent(0.3).cgColor
        frameLine.isHidden = !style.framed
        name.font = BookDesign.readingFont(style.titleSize)
        author.font = BookDesign.font(compact ? 8 : 11, style: .caption2)
        imprint.font = BookDesign.font(compact ? 7 : 9, style: .caption2)
        type.spacing = compact ? 4 : 10
        typeTop.constant = compact ? 12 : 20
        typeLeading.constant = compact ? 12 : 17
        typeTrailing.constant = compact ? -8 : -12
        typeBottom.constant = compact ? -10 : -16
        self.image.image = image
        self.image.isHidden = image == nil
        type.isHidden = image != nil
        frameLine.isHidden = image != nil || !style.framed
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

/// Shared book identity row used above grouped notes and conversations.
@MainActor
final class BookGroupHeader: UIControl {
    private let cover = UIView()
    private let coverImage = UIImageView()
    private let initial = BookDesign.label(nil, size: 11, weight: .semibold, colour: BookDesign.paper)
    private let title = BookDesign.label(nil, size: 12, colour: BookDesign.secondary)
    private let count = BookDesign.label(nil, size: 11, colour: BookDesign.secondary)
    private let chevron = UIImageView(image: BookDesign.symbol("chevron.right", size: 13, weight: .semibold))
    private var token = UUID()
    var onToggle: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = BookDesign.paper
        cover.layer.cornerRadius = 2
        cover.clipsToBounds = true
        coverImage.contentMode = .scaleAspectFill
        coverImage.clipsToBounds = true
        initial.textAlignment = .center
        initial.isHidden = true
        for child in [coverImage, initial] {
            child.translatesAutoresizingMaskIntoConstraints = false
            cover.addSubview(child)
        }
        let text = UIStackView(arrangedSubviews: [title, count])
        text.axis = .vertical
        text.spacing = 2
        chevron.tintColor = BookDesign.secondary
        chevron.contentMode = .scaleAspectFit
        let row = UIStackView(arrangedSubviews: [cover, text, chevron])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 8
        row.translatesAutoresizingMaskIntoConstraints = false
        row.isUserInteractionEnabled = false
        addSubview(row)
        NSLayoutConstraint.activate([
            heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            cover.widthAnchor.constraint(equalToConstant: 22),
            cover.heightAnchor.constraint(equalToConstant: 30),
            coverImage.topAnchor.constraint(equalTo: cover.topAnchor),
            coverImage.leadingAnchor.constraint(equalTo: cover.leadingAnchor),
            coverImage.trailingAnchor.constraint(equalTo: cover.trailingAnchor),
            coverImage.bottomAnchor.constraint(equalTo: cover.bottomAnchor),
            initial.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
            initial.centerYAnchor.constraint(equalTo: cover.centerYAnchor),
            chevron.widthAnchor.constraint(equalToConstant: 16),
            chevron.heightAnchor.constraint(equalToConstant: 20),
            row.topAnchor.constraint(equalTo: topAnchor, constant: 8),
            row.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 24),
            row.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -24),
            row.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -8)
        ])
        isAccessibilityElement = true
        accessibilityTraits = [.header, .button]
        accessibilityHint = "轻点展开或收起本书的记录"
        addAction(UIAction { [weak self] _ in self?.onToggle?() }, for: .touchUpInside)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func configure(
        bookID: String,
        bookTitle: String,
        book: Book?,
        covers: BookCoverStore,
        library: LibraryStore,
        identifierPrefix: String,
        countText: String,
        expanded: Bool,
        searching: Bool = false
    ) {
        token = UUID()
        let current = token
        title.text = bookTitle
        count.text = countText
        chevron.transform = expanded ? CGAffineTransform(rotationAngle: .pi / 2) : .identity
        accessibilityIdentifier = "\(identifierPrefix)-\(bookID)"
        accessibilityLabel = "\(bookTitle)，\(countText)"
        accessibilityValue = expanded ? "已展开" : "已收起"
        accessibilityHint = searching ? "搜索期间自动展开匹配记录" : "轻点展开或收起本书的记录"
        cover.backgroundColor = palette(for: bookTitle)
        coverImage.image = nil
        initial.text = String(bookTitle.prefix(1))
        initial.isHidden = false
        guard let book else { return }
        Task { [weak self] in
            let image = await covers.image(for: book, library: library)
            guard let self, token == current else { return }
            coverImage.image = image
            initial.isHidden = image != nil
        }
    }

    override func accessibilityActivate() -> Bool {
        sendActions(for: .touchUpInside)
        return true
    }

    private func palette(for title: String) -> UIColor {
        let colours = [0x565D4A, 0x79513E, 0x4E626B, 0x75634C]
        let index = title.utf8.reduce(0) { ($0 + Int($1)) % colours.count }
        return BookDesign.rgb(colours[index])
    }
}
