import XCTest
import UIKit
@testable import Shudeng

@MainActor
final class DesignFixtureTests: XCTestCase {
    func testFixtureRequiresExplicitLaunchArgument() {
        XCTAssertNil(DesignFixture.request(in: []))
        XCTAssertNil(DesignFixture.request(in: ["--isolated-reading-test"]))
        XCTAssertEqual(DesignFixture.request(in: ["--design-fixture"])?.scenario, .normal)
        XCTAssertEqual(DesignFixture.request(in: ["--design-fixture=empty", "--design-theme=dark"])?.scenario, .empty)
        XCTAssertEqual(DesignFixture.request(in: ["--design-fixture=normal", "--design-theme=dark"])?.theme, .dark)
    }

    func testFixedFixtureRendersBothContentSizesAndThemes() async throws {
        let request = DesignFixture.Request(scenario: .normal, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)

        XCTAssertEqual(Set(session.library.books.map(\.title)), ["红楼梦", "瓦尔登湖", "论语"])
        let primary = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.fixtureTitle })
        XCTAssertNotNil(primary.locatorJSON)
        XCTAssertFalse(primary.notes?.isEmpty ?? true)
        XCTAssertFalse(primary.bookmarks?.isEmpty ?? true)
        XCTAssertEqual(session.library.questions.conversations.count, 2)
        XCTAssertTrue(session.root.path.contains(FileManager.default.temporaryDirectory.path))

        let sizes = [
            CGSize(width: 375, height: 667),
            CGSize(width: 390, height: 844)
        ]
        let themes: [(UIUserInterfaceStyle, String)] = [(.light, "light"), (.dark, "dark")]
        let tabs = ["shelf", "notes", "conversations", "profile"]

        for size in sizes {
            for (theme, themeName) in themes {
                let root = makeApplicationTabs(library: session.library, root: session.root, secrets: session.secrets)
                for (index, tab) in tabs.enumerated() {
                    root.selectedIndex = index
                    let image = DesignFixture.renderRoot(root, size: size, style: theme)
                    XCTAssertEqual(image.size, size)
                    let attachment = XCTAttachment(
                        data: try XCTUnwrap(image.pngData()),
                        uniformTypeIdentifier: "public.png"
                    )
                    attachment.name = "design-baseline-\(tab)-\(Int(size.width))x\(Int(size.height))-\(themeName)"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                }
            }
        }
    }
}
