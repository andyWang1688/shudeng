import UIKit
import ReadiumShared
import ReadiumNavigator

@MainActor
final class ReaderController: UIViewController, EPUBNavigatorDelegate {
    private let book: Book
    private let library: LibraryStore
    private let navigator: EPUBNavigatorViewController
    private let status = UILabel()
    private let retry = UIButton(type: .system)
    private var captureTask: Task<Void, Never>?
    private var generation = 0
    private var pendingLocation: Locator?
    private var saveFailed = false

    init(book: Book, publication: Publication, library: LibraryStore) throws {
        self.book = book
        self.library = library
        navigator = try EPUBNavigatorViewController(publication: publication, initialLocation: library.location(for: book.id),
                                                   config: .init(preferences: EPUBPreferences(scroll: false)))
        super.init(nibName: nil, bundle: nil)
        navigator.delegate = self
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let close = UIButton(type: .system)
        close.setTitle("书架", for: .normal)
        close.addTarget(self, action: #selector(closeReader), for: .touchUpInside)
        let title = UILabel()
        title.text = book.title
        title.font = .preferredFont(forTextStyle: .subheadline)
        title.lineBreakMode = .byTruncatingTail
        let header = UIStackView(arrangedSubviews: [close, title])
        header.spacing = 16
        close.setContentHuggingPriority(.required, for: .horizontal)
        close.setContentCompressionResistancePriority(.required, for: .horizontal)
        status.font = .preferredFont(forTextStyle: .caption1)
        status.textColor = .secondaryLabel
        status.numberOfLines = 0
        status.accessibilityIdentifier = "reading-save-status"
        status.text = "正在打开…"
        retry.setTitle("重试保存", for: .normal)
        retry.addTarget(self, action: #selector(retrySave), for: .touchUpInside)
        retry.isHidden = true
        let footer = UIStackView(arrangedSubviews: [status, retry])
        footer.spacing = 12
        retry.setContentCompressionResistancePriority(.required, for: .horizontal)
        addChild(navigator)
        for child in [header, navigator.view!, footer] { child.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(child) }
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 4),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            header.heightAnchor.constraint(greaterThanOrEqualToConstant: 40),
            navigator.view.topAnchor.constraint(equalTo: header.bottomAnchor),
            navigator.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            navigator.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            navigator.view.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -4),
            footer.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            footer.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            footer.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -4),
            footer.heightAnchor.constraint(greaterThanOrEqualToConstant: 28)
        ])
        navigator.didMove(toParent: self)
        NotificationCenter.default.addObserver(self, selector: #selector(background), name: UIApplication.willResignActiveNotification, object: nil)
    }
    deinit { captureTask?.cancel(); NotificationCenter.default.removeObserver(self) }

    func navigator(_ navigator: Navigator, locationDidChange locator: Locator) {
        generation += 1
        let currentGeneration = generation
        pendingLocation = locator
        // Commit the navigator's real resource/progression immediately, then enrich
        // it with the visible element anchor once WebKit has settled. Never let a
        // delayed capture from an earlier page overwrite a newer location.
        persistPending()
        captureTask?.cancel()
        captureTask = Task { [weak self] in
            guard let self else { return }
            let anchored = await self.navigator.firstVisibleElementLocator()
            guard !Task.isCancelled, currentGeneration == self.generation, let anchored else { return }
            self.pendingLocation = anchored
            self.persistPending()
        }
    }
    private func persistPending() {
        guard let pendingLocation else { return }
        do {
            try library.saveLocation(pendingLocation, for: book.id)
            saveFailed = false
            status.text = "阅读位置已保存"
            status.textColor = .secondaryLabel
            retry.isHidden = true
        } catch {
            saveFailed = true
            status.text = "位置保存失败，重启将恢复上次已保存位置"
            status.textColor = .systemRed
            retry.isHidden = false
        }
    }
    @objc private func retrySave() { persistPending() }
    @objc private func background() { persistPending() }
    @objc private func closeReader() {
        persistPending()
        guard !saveFailed else {
            let alert = UIAlertController(title: "阅读位置尚未保存", message: "返回书架后，未保存的位置可能丢失。", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "留在阅读页", style: .cancel))
            alert.addAction(UIAlertAction(title: "仍然返回", style: .destructive) { [weak self] _ in self?.dismiss(animated: true) })
            present(alert, animated: true)
            return
        }
        dismiss(animated: true)
    }
    func navigator(_ navigator: Navigator, presentError error: NavigatorError) { showError() }
    func navigator(_ navigator: Navigator, didFailToLoadResourceAt href: RelativeURL, withError error: ReadError) { showError() }
    private func showError() {
        guard presentedViewController == nil else { return }
        let alert = UIAlertController(title: "原文加载失败", message: "无法读取此处内容，请返回书架后重新打开。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }
}
