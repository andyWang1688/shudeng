import UIKit

/// Pure UIKit text metrics; no business layout or Expo dependency.
/// The Interface measures one plain string at a caller-supplied CONTENT width.
@MainActor
enum TextMetricsEngine {
    enum Face: Equatable { case system(UIFont.Weight), named(String) }
    struct Typography: Equatable {
        let face: Face
        let basePointSize: CGFloat
        let metricsStyle: UIFont.TextStyle
        let lineSpacing: CGFloat
    }
    struct Request: Equatable {
        let bindingID: String // New for each JS anchor mount; rejects recycled-view events.
        let revision: Int // Monotonic per binding, including final-width remeasurement.
        let text: String // Unmodified: no trim, Unicode normalization or ellipsis.
        let maxContentWidth: CGFloat
        let typography: Typography
    }
    struct Environment: Equatable {
        let category: String
        let displayScale: CGFloat
        let rightToLeft: Bool
        let legibilityWeight: Int
        let boldText: Bool
        let preferredLanguages: [String]
    }
    struct Metrics {
        let fit: CGSize // Raw UILabel result; TS owns padding/cap/pixel rounding.
        let resolvedPointSize: CGFloat
        let resolvedFontName: String // Diagnostic identity, not an RN fontFamily alias.
    }
    enum Failure: Error { case invalidInput, unavailableFont, invalidResolvedFont }

    static func measure(_ request: Request, traits: UITraitCollection, rightToLeft: Bool) throws -> Metrics {
        let style = request.typography
        guard request.maxContentWidth.isFinite, request.maxContentWidth > 0,
              style.basePointSize.isFinite, style.basePointSize > 0,
              style.lineSpacing.isFinite, style.lineSpacing >= 0 else { throw Failure.invalidInput }
        let base: UIFont
        switch style.face {
        case .system(let weight): base = .systemFont(ofSize: style.basePointSize, weight: weight)
        case .named(let name):
            guard let font = UIFont(name: name, size: style.basePointSize) else { throw Failure.unavailableFont }
            base = font // No silent fallback when a named face is unavailable.
        }
        let font = UIFontMetrics(forTextStyle: style.metricsStyle).scaledFont(for: base, compatibleWith: traits)
        let label = UILabel(); label.numberOfLines = 0
        // A detached auto-adjusting label can reset a scaled font to category L.
        // This oracle uses the explicit font resolved from the ACTUAL local traits.
        label.adjustsFontForContentSizeCategory = false
        label.semanticContentAttribute = rightToLeft ? .forceRightToLeft : .forceLeftToRight
        label.font = font
        let paragraph = NSMutableParagraphStyle(); paragraph.lineSpacing = style.lineSpacing
        label.attributedText = NSAttributedString(string: request.text, attributes: [.font: font, .paragraphStyle: paragraph])
        guard abs(label.font.pointSize - font.pointSize) < 0.01, label.font.fontName == font.fontName else {
            throw Failure.invalidResolvedFont
        }
        if !request.text.isEmpty {
            guard let actual = label.attributedText?.attribute(.font, at: 0, effectiveRange: nil) as? UIFont,
                  abs(actual.pointSize - font.pointSize) < 0.01, actual.fontName == font.fontName else {
                throw Failure.invalidResolvedFont
            }
        }
        let size = label.sizeThatFits(CGSize(width: request.maxContentWidth, height: .greatestFiniteMagnitude))
        guard size.width.isFinite, size.height.isFinite, size.width >= 0, size.height >= 0,
              font.pointSize.isFinite, font.pointSize > 0 else { throw Failure.invalidResolvedFont }
        return Metrics(fit: size, resolvedPointSize: font.pointSize, resolvedFontName: font.fontName)
    }
}

