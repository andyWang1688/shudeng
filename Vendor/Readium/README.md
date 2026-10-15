# Readium Swift 3.11.0

Upstream: https://github.com/readium/swift-toolkit/tree/3.11.0
Source archive: https://github.com/readium/swift-toolkit/archive/refs/tags/3.11.0.tar.gz

This checked-in source makes resource removal reproducible before signing, without a temporary-directory dependency. `Package.swift` retains only Shared, Streamer, Navigator and their exact-version dependencies; unused upstream targets and the Navigator JS build sources are not app dependencies. Prebuilt upstream JavaScript assets are unchanged.

Local modification: removed all five legacy `OpenDyslexic-*.otf` assets and automatic font declarations in `EPUBNavigatorViewModel.swift`. No pagination changes in this ticket. License text is retained in LICENSE and the app's ThirdPartyNotices.txt (including Swift dependencies, bundled JS runtime closure, CSS, fonts and Hypothesis). Original upstream source headers remain intact.
