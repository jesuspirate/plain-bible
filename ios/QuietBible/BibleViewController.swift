import UIKit
import WebKit

/// The whole app: myquietbible.com in a web view, as on a Home Screen.
/// The site's own service worker keeps it working offline after the first
/// start (service workers run here because the site is an app-bound domain,
/// see WKAppBoundDomains in Info.plist). Nothing of the web app is copied in,
/// so the app always has the same version as the website.
final class BibleViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    static let home = URL(string: "https://myquietbible.com/")!
    static let host = "myquietbible.com"

    private var web: WKWebView!
    private var start: URL?
    private var loaded = false
    private var offline: UIView?
    private var themeWatch: NSKeyValueObservation?
    private var barStyle: UIStatusBarStyle = .darkContent
    private var downloads: [ObjectIdentifier: URL] = [:]
    private var watchArrivals: NSObjectProtocol?
    private var circleTaps: NSObjectProtocol?
    private var circleNews: NSObjectProtocol?
    private var macKeyboard: [NSObjectProtocol] = []
    private var macAway: [NSObjectProtocol] = []
    private var lastPicture: UIImage?
    private var cover: UIImageView?
    private var isAway = false

    override var preferredStatusBarStyle: UIStatusBarStyle { barStyle }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.limitsNavigationsToAppBoundDomains = true
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // The web app reads this to leave out what only fits a website.
        config.applicationNameForUserAgent = "Mobile/15E148 QuietBibleApp/1"
        // Passkeys on a Mac, where the web view has none (PasskeyBridge.swift).
        config.userContentController.addUserScript(PasskeyBridge.script)
        config.userContentController.addScriptMessageHandler(PasskeyBridge(), contentWorld: .page, name: PasskeyBridge.name)

        // Behave exactly like the app on an iPhone Home Screen (no "Add to
        // Home Screen" tips, the keyboard's mic for voice search).
        config.userContentController.addUserScript(WKUserScript(
            source: "Object.defineProperty(navigator, 'standalone', { get: () => true })",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // Prayers from the Apple Watch app (WatchInbox.swift).
        config.userContentController.addScriptMessageHandler(WatchBridge(), contentWorld: .page, name: "watch")
        // Circle notifications and the widget's circle news (Notify.swift).
        config.userContentController.addScriptMessageHandler(NotifyBridge(), contentWorld: .page, name: "notify")

        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        // Sideways swipes turn chapters; they must not go "back".
        web.allowsBackForwardNavigationGestures = false
        web.allowsLinkPreview = false
        // The page lays itself out under the notch and home bar (viewport-fit=cover).
        web.scrollView.contentInsetAdjustmentBehavior = .never
        // iOS 26 softly blurs a scroll view's content near the top and bottom
        // edges, under the clock and the home bar. Here that smeared the
        // page's own top bar (title and buttons looked out of focus). The page
        // draws its own bars, so turn the system's blur off.
        // (Only Xcode 26 and later know these; older Xcode skips them.)
        #if compiler(>=6.2)
        if #available(iOS 26.0, *) {
            web.scrollView.topEdgeEffect.isHidden = true
            web.scrollView.bottomEdgeEffect.isHidden = true
        }
        #endif
        Self.hideKeyboardBar(in: web)
        web.isOpaque = false
        let paper = UIColor(named: "LaunchBackground")
        web.backgroundColor = paper
        web.scrollView.backgroundColor = paper
        #if DEBUG
        if #available(iOS 16.4, *) { web.isInspectable = true }
        #endif
        // The page sets its theme color (Light, Sepia, Dark); the status bar follows.
        themeWatch = web.observe(\.themeColor, options: [.initial, .new]) { [weak self] web, _ in
            self?.tint(web.themeColor)
        }
        self.web = web
        view = web
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        web.load(URLRequest(url: start ?? Self.home))
        // A prayer from the watch arrived while the app is open: the web app takes it.
        watchArrivals = NotificationCenter.default.addObserver(forName: WatchInbox.arrived, object: nil, queue: .main) { [weak self] _ in
            self?.web.evaluateJavaScript("dispatchEvent(new Event('quietbible:watch'))")
        }
        // A circle's notification was tapped: open that circle.
        circleTaps = NotificationCenter.default.addObserver(forName: Notify.opened, object: nil, queue: .main) { [weak self] _ in
            self?.openTappedCircle()
        }
        // One arrived while the app is open: the page lights its dot.
        circleNews = NotificationCenter.default.addObserver(forName: Notify.arrived, object: nil, queue: .main) { [weak self] _ in
            self?.web.evaluateJavaScript("dispatchEvent(new Event('quietbible:circle-news'))")
        }
        openTappedCircle()
        watchMacKeyboardStrip()
        keepPageWhileAwayOnMac()
    }

    /// On a Mac in full screen, going to another Space puts the app in the
    /// background, and the web view lets go of its drawn page. Coming back,
    /// the window slid in empty (just the paper color) and the text came a
    /// second later, every time. So: when the app steps back, keep a picture
    /// of the page; while it is away, that picture lies over the web view;
    /// back again, it goes once the page has drawn itself. iPhone and iPad
    /// keep their own snapshot for the app switcher and are left as they are.
    private func keepPageWhileAwayOnMac() {
        guard ProcessInfo.processInfo.isiOSAppOnMac else { return }
        let center = NotificationCenter.default
        let mine: (Notification) -> Bool = { [weak self] note in
            (note.object as? UIScene) === self?.view.window?.windowScene
        }
        macAway = [
            // Still drawn and running here: take the picture now.
            center.addObserver(forName: UIScene.willDeactivateNotification, object: nil, queue: .main) { [weak self] note in
                guard let self, mine(note), self.cover == nil else { return }
                self.web.takeSnapshot(with: nil) { [weak self] image, _ in
                    guard let self, let image else { return }
                    self.lastPicture = image
                    if self.isAway { self.coverPage() }
                }
            },
            center.addObserver(forName: UIScene.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] note in
                guard let self, mine(note) else { return }
                self.isAway = true
                self.coverPage()
            },
            center.addObserver(forName: UIScene.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] note in
                guard let self, mine(note) else { return }
                self.isAway = false
                self.uncoverOnceDrawn()
            },
            // Back without ever going to the background (another app was in
            // front, the window stayed in view): the picture isn't needed.
            center.addObserver(forName: UIScene.didActivateNotification, object: nil, queue: .main) { [weak self] note in
                guard let self, mine(note), self.cover == nil else { return }
                self.lastPicture = nil
            },
        ]
    }

    private func coverPage() {
        guard cover == nil, let picture = lastPicture else { return }
        let still = UIImageView(image: picture)
        still.frame = view.bounds
        still.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        // Never stretched: if the window changed size meanwhile, the page
        // underneath comes a moment later anyway.
        still.contentMode = .topLeft
        still.backgroundColor = web.backgroundColor
        still.accessibilityElementsHidden = true
        view.addSubview(still)
        cover = still
    }

    /// The page has drawn itself again once it has had two frames; then the
    /// picture fades away (within 3 seconds in any case).
    private func uncoverOnceDrawn() {
        guard let still = cover else { lastPicture = nil; return }
        let done: () -> Void = { [weak self] in
            guard let self, self.cover === still else { return }
            self.cover = nil
            self.lastPicture = nil
            UIView.animate(withDuration: 0.15, animations: { still.alpha = 0 }) { _ in still.removeFromSuperview() }
        }
        web.callAsyncJavaScript(
            "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
            arguments: [:], in: nil, in: .page) { _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05, execute: done)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: done)
    }

    /// On a Mac, while a field is being typed in, the system lays a dark
    /// strip over the bottom of the window (most visible in full screen),
    /// and the page isn't told: the search bar and Cancel ended up under it.
    /// Count the strip as safe area, so the page keeps its bars above it the
    /// way it keeps them above an iPhone's home bar. iPhone and iPad are left
    /// as they are: there the keyboard is handled by the page.
    private func watchMacKeyboardStrip() {
        guard ProcessInfo.processInfo.isiOSAppOnMac else { return }
        let center = NotificationCenter.default
        let fit: (Notification) -> Void = { [weak self] note in
            guard let self, let view = self.view, let screen = view.window?.screen,
                  let end = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
            let frame = view.convert(end, from: screen.coordinateSpace)
            // The window's own safe area already counts; add only the rest.
            let own = view.safeAreaInsets.bottom - self.additionalSafeAreaInsets.bottom
            let covered = note.name == UIResponder.keyboardWillHideNotification ? 0
                : max(0, min(view.bounds.maxY - frame.minY, view.bounds.height / 3) - own)
            if self.additionalSafeAreaInsets.bottom != covered { self.additionalSafeAreaInsets.bottom = covered }
        }
        macKeyboard = [UIResponder.keyboardWillChangeFrameNotification, UIResponder.keyboardWillHideNotification]
            .map { center.addObserver(forName: $0, object: nil, queue: .main, using: fit) }
    }

    /// Open a myquietbible.com link (from a universal link).
    func open(_ url: URL) {
        guard url.host == Self.host else { return }
        if web == nil { start = url } else { web.load(URLRequest(url: url)) }
    }

    /// The Home Screen widget's buttons: quietbible://pray opens the prayer
    /// screen and quietbible://circles opens Circles, over the page you were
    /// reading; the verse of the day opens that verse. When the page is already up, only its address changes, so
    /// nothing reloads.
    func openWidgetLink(_ url: URL) {
        // quietbible://read/KJV/Ps/119?v=105: the verse of the day, in the reader.
        if url.scheme == "quietbible", url.host == "read" {
            let place = "read" + url.path + (url.query.map { "?" + $0 } ?? "")
            if SharedVerses.safePlace(place) { show(place) }
            return
        }
        guard url.scheme == "quietbible", var page = url.host, page == "pray" || page == "circles" else { return }
        // quietbible://circles/<id>: the one circle with something new.
        if page == "circles", let id = url.pathComponents.dropFirst().first, SharedCircles.safe(id) { page += "/" + id }
        show(page)
    }

    /// A tapped notification: its circle (or the list, if it named none).
    private func openTappedCircle() {
        guard let c = Notify.shared.takePending() else { return }
        show(c.isEmpty ? "circles" : "circles/" + c)
    }

    private func show(_ page: String) {
        if web != nil && loaded {
            web.evaluateJavaScript("location.hash = '#/\(page)'")
            return
        }
        guard let link = URL(string: "https://\(Self.host)/#/\(page)") else { return }
        start = link
        if web != nil { web.load(URLRequest(url: link)) }
    }

    /// Pages for the website's visitors (the welcome page, the privacy
    /// page): they open in Safari, like any other site.
    private static func websiteOnly(_ url: URL) -> Bool {
        url.path.hasPrefix("/welcome") || url.path == "/privacy.html"
    }

    private func tint(_ color: UIColor?) {
        guard let color else { return }
        var white: CGFloat = 1
        color.getWhite(&white, alpha: nil)
        barStyle = white < 0.4 ? .lightContent : .darkContent
        web.backgroundColor = color
        web.scrollView.backgroundColor = color
        setNeedsStatusBarAppearanceUpdate()
    }

    // MARK: Links

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if action.shouldPerformDownload { return decisionHandler(.download) }
        switch url.scheme {
        case "blob", "data", "about":
            return decisionHandler(.allow)
        case "http", "https":
            if url.host == Self.host {
                // Gifts can't be asked for inside an App Store app; the web app
                // hides these links here, and this keeps the page closed too.
                if url.path.hasPrefix("/support") { return decisionHandler(.cancel) }
                if !Self.websiteOnly(url) { return decisionHandler(.allow) }
            }
        default:
            break
        }
        // Everything else (licenses, sources, mail) opens in its own app.
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    /// target="_blank" and window.open.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if url.host == Self.host, url.path.hasPrefix("/support") { return nil }
            if url.host == Self.host, !Self.websiteOnly(url) { webView.load(action.request) }
            else if url.scheme == "http" || url.scheme == "https" { UIApplication.shared.open(url) }
        }
        return nil
    }

    /// Prayers are recorded on myquietbible.com only; iOS still asks once.
    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.host == Self.host && type == .microphone ? .grant : .deny)
    }

    // MARK: First start without a connection

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        offline?.removeFromSuperview()
        offline = nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let e = error as NSError
        if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
        if e.domain == "WebKitErrorDomain" && e.code == 102 { return } // handed to a download or another app
        if !loaded { showOffline() }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    private func showOffline() {
        guard offline == nil else { return }
        let (message, retry) = Self.offlineWords()
        let label = UILabel()
        label.text = message
        label.font = .preferredFont(forTextStyle: .title3)
        label.adjustsFontForContentSizeCategory = true
        label.numberOfLines = 0
        label.textAlignment = .center
        label.textColor = UIColor(red: 0.24, green: 0.18, blue: 0.12, alpha: 1)

        var look = UIButton.Configuration.filled()
        look.title = retry
        look.baseBackgroundColor = UIColor(red: 0.45, green: 0.29, blue: 0.16, alpha: 1)
        look.cornerStyle = .capsule
        look.contentInsets = NSDirectionalEdgeInsets(top: 14, leading: 32, bottom: 14, trailing: 32)
        let button = UIButton(configuration: look, primaryAction: UIAction { [weak self] _ in
            guard let self else { return }
            self.web.load(URLRequest(url: self.start ?? Self.home))
        })
        button.titleLabel?.font = .preferredFont(forTextStyle: .headline)

        let stack = UIStackView(arrangedSubviews: [label, button])
        stack.axis = .vertical
        stack.spacing = 24
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false

        let cover = UIView()
        cover.backgroundColor = UIColor(named: "LaunchBackground")
        cover.translatesAutoresizingMaskIntoConstraints = false
        cover.addSubview(stack)
        view.addSubview(cover)
        NSLayoutConstraint.activate([
            cover.topAnchor.constraint(equalTo: view.topAnchor),
            cover.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            cover.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            cover.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            stack.centerYAnchor.constraint(equalTo: cover.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: cover.layoutMarginsGuide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: cover.layoutMarginsGuide.trailingAnchor, constant: -16),
            button.heightAnchor.constraint(greaterThanOrEqualToConstant: 52),
        ])
        offline = cover
    }

    private static func offlineWords() -> (String, String) {
        switch Locale.preferredLanguages.first?.prefix(2) {
        case "fr": return ("Connectez-vous à Internet une première fois pour ouvrir My Quiet Bible. Ensuite, elle fonctionne sans connexion.", "Réessayer")
        case "es": return ("Conéctate a Internet una primera vez para abrir My Quiet Bible. Después funciona sin conexión.", "Reintentar")
        default: return ("Connect to the internet once to open My Quiet Bible. After that it works without a connection.", "Try again")
        }
    }

    // MARK: Downloads ("Download everything", saved prayers)

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent(suggestedFilename.isEmpty ? "My Quiet Bible" : suggestedFilename)
        downloads[ObjectIdentifier(download)] = file
        completionHandler(file)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        // The share sheet has "Save to Files" and every other place it can go.
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 0, height: 0)
        present(sheet, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
    }
}

// MARK: - No bar above the keyboard

/// A web view puts a bar with two arrows and a checkmark above the keyboard.
/// The app has one field at a time and its own Cancel and Done buttons, so
/// the bar only takes room. The bar belongs to the view inside the web view
/// that holds the page; this gives that one view a variant of its class
/// that answers "no bar". If iOS ever changes its insides, nothing is found
/// and the bar simply stays.
private final class NoKeyboardBar: NSObject {
    @objc var inputAccessoryView: UIView? { nil }
}

extension BibleViewController {
    fileprivate static func hideKeyboardBar(in web: WKWebView) {
        guard let page = web.scrollView.subviews.first(where: {
                  NSStringFromClass(type(of: $0)).hasPrefix("WKContent") }),
              let base: AnyClass = object_getClass(page) else { return }
        let name = NSStringFromClass(base) + "_NoKeyboardBar"
        var quiet: AnyClass? = NSClassFromString(name)
        if quiet == nil,
           let made: AnyClass = objc_allocateClassPair(base, name, 0),
           let none = class_getInstanceMethod(NoKeyboardBar.self,
                                              #selector(getter: NoKeyboardBar.inputAccessoryView)) {
            class_addMethod(made, #selector(getter: UIResponder.inputAccessoryView),
                            method_getImplementation(none), method_getTypeEncoding(none))
            objc_registerClassPair(made)
            quiet = made
        }
        if let quiet { object_setClass(page, quiet) }
    }
}
