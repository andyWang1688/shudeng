# Readium Swift 3.11.0

Upstream: https://github.com/readium/swift-toolkit/tree/3.11.0
Source archive: https://github.com/readium/swift-toolkit/archive/refs/tags/3.11.0.tar.gz

This checked-in source makes resource removal reproducible before signing, without a temporary-directory dependency. `Package.swift` retains only Shared, Streamer, Navigator and their exact-version dependencies; unused upstream targets and the Navigator JS build sources are not app dependencies. Prebuilt upstream JavaScript assets are unchanged.

Local modification: removed all five legacy `OpenDyslexic-*.otf` assets and automatic font declarations in `EPUBNavigatorViewModel.swift`. Shudeng adds `nativePaginationEnabled` in `EPUBNavigatorViewController.swift` to gate outer pagination and loaded/new inner WebKit scroll views. This app-maintained extension preserves text selection while UIKit owns curl gestures; public programmatic navigation remains available for prefetch. Revalidate all three sites on upstream upgrades. License text is retained in LICENSE and the app's ThirdPartyNotices.txt (including Swift dependencies, bundled JS runtime closure, CSS, fonts and Hypothesis). Original upstream source headers remain intact.

Upstream 3.11.0 source archive SHA-256: `6c8033e1927d7ef83f64c73eee8c335c04e4be071c07d169dbb704947fc4ace1`.
