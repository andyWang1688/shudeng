import UIKit
import ReadiumShared

/// Shared paper, ink and lamp colours. All values adapt without changing system text size.
enum BookDesign {
    static let paper = colour(0xFCFBF8, 0x20231F)
    static let surface = colour(0xF2F0E9, 0x292D27)
    static let ink = colour(0x282B26, 0xF0F1E9)
    static let secondary = colour(0x64675F, 0xC0C4B8)
    static let lamp = colour(0x8A590D, 0xEDC579)
    static let glow = colour(0xF4E9CE, 0x453A24)
    static let line = colour(0xE5E2D9, 0x41463B)
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
    static func label(_ text: String?, size: CGFloat = 16, weight: UIFont.Weight = .regular, colour: UIColor = ink) -> UILabel {
        let label = UILabel(); label.text = text; label.font = font(size, weight: weight)
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
}

/// Original EPUB cover, with a title-only fallback (never a made-up publisher cover).
final class BookCoverView: UIView {
    private let image = UIImageView()
    private let name = BookDesign.label(nil, size: 23, weight: .medium)
    private let author = BookDesign.label(nil, size: 11)
    private let imprint = BookDesign.label("书 灯 · 藏 书", size: 9)
    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.cornerRadius = 5; clipsToBounds = true
        image.contentMode = .scaleAspectFill; image.clipsToBounds = true
        name.font = BookDesign.readingFont(23)
        for label in [name, author, imprint] { label.textColor = BookDesign.rgb(0xF5EEDC) }
        let type = UIStackView(arrangedSubviews: [name, author, UIView(), imprint]); type.axis = .vertical; type.spacing = 10
        let spine = UIView(); spine.backgroundColor = UIColor.black.withAlphaComponent(0.12)
        for child in [type, image, spine] { child.translatesAutoresizingMaskIntoConstraints = false; addSubview(child) }
        NSLayoutConstraint.activate([
            type.topAnchor.constraint(equalTo: topAnchor, constant: 20), type.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 17),
            type.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12), type.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -16),
            image.topAnchor.constraint(equalTo: topAnchor), image.bottomAnchor.constraint(equalTo: bottomAnchor),
            image.leadingAnchor.constraint(equalTo: leadingAnchor), image.trailingAnchor.constraint(equalTo: trailingAnchor),
            spine.topAnchor.constraint(equalTo: topAnchor), spine.bottomAnchor.constraint(equalTo: bottomAnchor),
            spine.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 5), spine.widthAnchor.constraint(equalToConstant: 2)
        ])
        isAccessibilityElement = false; accessibilityElementsHidden = true
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    func configure(_ book: Book, image: UIImage?) {
        let palette = [0x565D4A, 0x79513E, 0x4E626B, 0x75634C]
        let index = book.id.utf8.reduce(0) { ($0 + Int($1)) % palette.count }
        backgroundColor = BookDesign.rgb(palette[index]); name.text = book.title; author.text = book.author
        self.image.image = image; self.image.isHidden = image == nil
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
