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
    private var pictureRound = 0
    /// The verses picked in the reader, as the Copy button copies them.
    fileprivate var pickedText = ""

    // Cmd+C with verses picked (a Mac or an iPad keyboard). The menu's Copy
    // asks the web view first; with no words selected it says no, and the
    // question comes here. Then copy the picked verses. With words selected,
    // the web view copies them as usual and this never runs.
    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(copy(_:)) { return !pickedText.isEmpty }
        return super.canPerformAction(action, withSender: sender)
    }

    override func copy(_ sender: Any?) {
        guard !pickedText.isEmpty else { return }
        UIPasteboard.general.string = pickedText
        web.evaluateJavaScript("dispatchEvent(new Event('quietbible:copied'))")
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { barStyle }

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.limitsNavigationsToAppBoundDomains = true
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // The web app reads this to leave out what only fits a website.
        config.applicationNameForUserAgent = "Mobile/15E148 QuietBibleApp/1"
            + (ProcessInfo.processInfo.isiOSAppOnMac ? " QuietBibleMac/1" : "")
        // On a Mac, swiping to another desktop (Space) away from the app in
        // full screen counts as the app going to the background, and the web
        // view then put the page to sleep. Back again, it had to wake and
        // draw the page from nothing, which took a second or more: the text
        // came in after the window. A Mac doesn't need that saving, and no
        // other app there does it, so the page stays awake.
        if #available(iOS 17.0, *), ProcessInfo.processInfo.isiOSAppOnMac { config.preferences.inactiveSchedulingPolicy = .none }
        // Passkeys on a Mac, where the web view has none (PasskeyBridge.swift).
        config.userContentController.addUserScript(PasskeyBridge.script)
        config.userContentController.addScriptMessageHandler(PasskeyBridge(), contentWorld: .page, name: PasskeyBridge.name)
        // Recording prayers on a Mac, where the web view has no microphone (PrayerMicBridge.swift).
        let mic = PrayerMicBridge()
        config.userContentController.addUserScript(PrayerMicBridge.script)
        config.userContentController.addScriptMessageHandler(mic, contentWorld: .page, name: PrayerMicBridge.name)

        // Behave exactly like the app on an iPhone Home Screen (no "Add to
        // Home Screen" tips, the keyboard's mic for voice search).
        config.userContentController.addUserScript(WKUserScript(
            source: "Object.defineProperty(navigator, 'standalone', { get: () => true })",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // Prayers from the Apple Watch app (WatchInbox.swift).
        config.userContentController.addScriptMessageHandler(WatchBridge(), contentWorld: .page, name: "watch")
        // Circle notifications and the widget's circle news (Notify.swift).
        config.userContentController.addScriptMessageHandler(NotifyBridge(), contentWorld: .page, name: "notify")
        // The verses picked in the reader, for Cmd+C (see copy(_:) below).
        config.userContentController.add(PickedBridge(self), contentWorld: .page, name: "picked")

        let web = WKWebView(frame: .zero, configuration: config)
        mic.web = web
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
    /// back again, it goes once the page has surely drawn itself. iPhone and
    /// iPad keep their own snapshot for the app switcher and are left alone.
    ///
    /// The first version asked the web view for its picture, which
    /// answers later, from the page's own process: often after macOS had
    /// already put that process to sleep, so after a swipe or two there was
    /// no picture and the blank came back. And it took the picture away as
    /// soon as the page had run two frames, sometimes before the text was
    /// back on screen. Now the picture is copied at once from what is on the
    /// screen, and stays a moment longer.
    private func keepPageWhileAwayOnMac() {
        guard ProcessInfo.processInfo.isiOSAppOnMac else { return }
        let center = NotificationCenter.default
        let mine: (Notification) -> Bool = { [weak self] note in
            (note.object as? UIScene) === self?.view.window?.windowScene
        }
        macAway = [
            // Still on screen: copy it now.
            center.addObserver(forName: UIScene.willDeactivateNotification, object: nil, queue: .main) { [weak self] note in
                guard let self, mine(note) else { return }
                MacReport.start()
                MacReport.note("stepping back; page drawn now: \(self.pageLooksDrawn())")
                self.takePicture()
            },
            center.addObserver(forName: UIScene.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] note in
                guard let self, mine(note) else { return }
                // Gone without stepping back first: copy it now, while the
                // page is still drawn.
                if self.lastPicture == nil { self.takePicture() }
                self.coverPage()
                MacReport.note("background; cover up: \(self.cover != nil)")
            },
            center.addObserver(forName: UIScene.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] note in
                guard let self, mine(note) else { return }
                MacReport.note("coming back; page drawn: \(self.pageLooksDrawn()); cover up: \(self.cover != nil)")
                self.uncoverOnceDrawn()
            },
            // Back in front: the next time away needs a new picture (an old
            // one could show another page).
            center.addObserver(forName: UIScene.didActivateNotification, object: nil, queue: .main) { [weak self] note in
                guard let self, mine(note) else { return }
                self.lastPicture = nil
                self.pictureRound += 1
                MacReport.note("in front; page drawn: \(self.pageLooksDrawn())")
                self.followComeback()
            },
        ]
    }

    /// A copy of what the window shows right now, taken here and at once
    /// (the page's own process isn't asked, so it can't come too late).
    private func takePicture() {
        let bounds = web.bounds
        guard bounds.width > 0, bounds.height > 0, web.window != nil else { return }
        let format = UIGraphicsImageRendererFormat(for: web.traitCollection)
        format.opaque = true
        var drawn = false
        let image = UIGraphicsImageRenderer(bounds: bounds, format: format).image { _ in
            drawn = web.drawHierarchy(in: bounds, afterScreenUpdates: false)
        }
        if drawn { lastPicture = image }
        MacReport.note("copy: drawn \(drawn), blank \(Self.blank(image))")
        // The web view's own picture as well, in case the copy came out
        // without the page: when it arrives (if it arrives while still away,
        // or before), it takes the copy's place.
        pictureRound += 1
        let round = pictureRound
        web.takeSnapshot(with: nil) { [weak self] image, _ in
            guard let self, let image, round == self.pictureRound else { return }
            MacReport.note("web view's own picture arrived, blank \(Self.blank(image)), cover up: \(self.cover != nil)")
            // A blank one is no better than the copy (the page may already
            // have let go of its drawing).
            if Self.blank(image) { return }
            self.lastPicture = image
            self.cover?.image = image
        }
    }

    /// TEMPORARY report (TestFlight on a Mac): after coming back, look at
    /// the page a few times, then copy the timeline to the clipboard.
    private func followComeback() {
        guard MacReport.on else { return }
        for t in [0.1, 0.3, 0.6, 1.0, 2.0, 4.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + t) { [weak self] in
                guard let self else { return }
                MacReport.note("+\(t) s: page drawn: \(self.pageLooksDrawn()); cover up: \(self.cover != nil)")
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 4.2) { [weak self] in
            self?.web.evaluateJavaScript("[document.visibilityState, document.querySelectorAll('.reader article').length, (document.body.innerText || '').length, getComputedStyle(document.body).opacity, document.documentElement.className].join(' | ')") { value, error in
                MacReport.note("page says: \(value.map { "\($0)" } ?? "no answer \(error.map { "\($0)" } ?? "")")")
                MacReport.copy(title: "full screen")
            }
        }
    }

    /// Whether the page's own drawing (not the cover over it) shows more
    /// than plain paper. For the report only.
    private func pageLooksDrawn() -> String {
        guard MacReport.on else { return "" }
        let layer = web.scrollView
        let bounds = layer.bounds
        guard bounds.width > 0, bounds.height > 0 else { return "no size" }
        let format = UIGraphicsImageRendererFormat(for: web.traitCollection)
        format.opaque = true
        var ok = false
        let image = UIGraphicsImageRenderer(bounds: bounds, format: format).image { _ in
            ok = layer.drawHierarchy(in: bounds, afterScreenUpdates: false)
        }
        return ok ? (Self.blank(image) ? "BLANK" : "yes") : "can't tell"
    }

    /// Plain paper, nothing on it: every pixel of a small copy alike.
    static func blank(_ image: UIImage) -> Bool {
        guard let cg = image.cgImage else { return true }
        let side = 16
        var px = [UInt8](repeating: 0, count: side * side * 4)
        guard let ctx = CGContext(data: &px, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return true }
        ctx.interpolationQuality = .medium
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: side, height: side))
        var spread = 0
        for i in stride(from: 0, to: px.count, by: 4) {
            for c in 0..<3 { spread = max(spread, abs(Int(px[i + c]) - Int(px[c]))) }
        }
        return spread < 6
    }

    private func coverPage() {
        guard let picture = lastPicture else { return }
        if let old = cover { old.removeFromSuperview() }
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

    /// The picture stays until the page has run two frames and at least a
    /// second has gone by (the text can come a little after those frames),
    /// then fades away; after 3 seconds it goes in any case. It shows the
    /// same page, so holding it a little longer costs nothing.
    private func uncoverOnceDrawn() {
        guard let still = cover else { return }
        let back = Date()
        let done: () -> Void = { [weak self] in
            guard let self, self.cover === still else { return }
            MacReport.note("cover taken away; page drawn: \(self.pageLooksDrawn())")
            self.cover = nil
            UIView.animate(withDuration: 0.2, animations: { still.alpha = 0 }) { _ in still.removeFromSuperview() }
        }
        web.callAsyncJavaScript(
            "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))",
            arguments: [:], in: nil, in: .page) { _ in
            let wait = max(0.3, 1.0 - Date().timeIntervalSince(back))
            DispatchQueue.main.asyncAfter(deadline: .now() + wait, execute: done)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3, execute: done)
    }

    /// On a Mac, while a field is being typed in, the system puts up an
    /// empty 44 point "keyboard" along the bottom of the window (a dark
    /// strip, most visible in full screen) and tells everyone a keyboard
    /// came up. Two things followed that made search jump on a Mac:
    /// - the web view made room for that keyboard: it scrolled the whole
    ///   page up when the field got focus, and slid it back down over half
    ///   a second after (Escape most of all), so the book changed size and
    ///   the words moved from page to page each time search closed;
    /// - this app counted the strip as safe area, which moved the bars.
    /// A Mac has no keyboard on screen to make room for. So the web view no
    /// longer hears about it, the strip is made invisible, and the page is
    /// left exactly as it is. Only if a future macOS keeps the strip from
    /// being hidden is it counted as safe area, so the search bar stays
    /// above it. iPhone and iPad are left as they are.
    private func watchMacKeyboardStrip() {
        guard ProcessInfo.processInfo.isiOSAppOnMac else { return }
        let center = NotificationCenter.default
        // The web view listens for keyboard notices to make room above a
        // keyboard; stop it listening (here only, on a Mac).
        let notices = [UIResponder.keyboardWillShowNotification, UIResponder.keyboardDidShowNotification,
                       UIResponder.keyboardWillHideNotification, UIResponder.keyboardDidHideNotification,
                       UIResponder.keyboardWillChangeFrameNotification, UIResponder.keyboardDidChangeFrameNotification]
        if let web { notices.forEach { center.removeObserver(web, name: $0, object: nil) } }
        let fit: (Notification) -> Void = { [weak self] note in
            guard let self, let view = self.view, let screen = view.window?.screen,
                  let end = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
            let frame = view.convert(end, from: screen.coordinateSpace)
            let hiding = note.name == UIResponder.keyboardWillHideNotification
            // The strip is the system's empty keyboard bar (a 44 point
            // UIInputSetHostView with a dark see-through backdrop, in the
            // UITextEffectsWindow). Make it invisible, at every notice
            // (the system can show it again while laying it out) and once
            // more a moment later. Typing is unaffected: keys go to the
            // field, not to this bar.
            let hidden = !hiding && self.hideMacInputBar()
            if !hiding { DispatchQueue.main.async { [weak self] in _ = self?.hideMacInputBar() } }
            // The window's own safe area already counts; add only the rest.
            let own = view.safeAreaInsets.bottom - self.additionalSafeAreaInsets.bottom
            let covered = hiding || hidden ? 0
                : max(0, min(view.bounds.maxY - frame.minY, view.bounds.height / 3) - own)
            if self.additionalSafeAreaInsets.bottom != covered { self.additionalSafeAreaInsets.bottom = covered }
        }
        macKeyboard = [UIResponder.keyboardWillChangeFrameNotification, UIResponder.keyboardWillHideNotification,
                       UIResponder.keyboardDidShowNotification, UIResponder.keyboardDidChangeFrameNotification]
            .map { center.addObserver(forName: $0, object: nil, queue: .main, using: fit) }
    }

    /// Mac only: make the system's keyboard bar invisible. Found by class
    /// name, so a future macOS that changes it just leaves the bar showing
    /// (the safe area lift above then keeps the page's bars clear of it).
    /// Returns whether it was found.
    /// Never replace the input view instead: that crashes on a Mac (#306).
    private func hideMacInputBar() -> Bool {
        guard let windows = view.window?.windowScene?.windows else { return false }
        var found = false
        for window in windows where NSStringFromClass(type(of: window)).contains("TextEffectsWindow") {
            var stack: [UIView] = window.subviews
            while let next = stack.popLast() {
                if NSStringFromClass(type(of: next)) == "UIInputSetHostView" {
                    // Both the bar and its pieces: the dark backdrop and the
                    // empty 44 point input view under it.
                    for piece in [next] + next.subviews + next.subviews.flatMap(\.subviews) {
                        if piece.alpha != 0 { piece.alpha = 0 }
                        if !piece.isHidden { piece.isHidden = true }
                    }
                    found = true
                } else {
                    stack.append(contentsOf: next.subviews)
                }
            }
        }
        return found
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
        // With a keyboard attached (always so on a Mac), iPad and Mac lay a
        // shortcuts strip (undo, paste...) along the bottom of the window
        // while a field is typed in, and it could stay after the field was
        // closed: a grey bar with a handle under the page. With no shortcuts
        // in it, the system doesn't show it at all.
        page.inputAssistantItem.leadingBarButtonGroups = []
        page.inputAssistantItem.trailingBarButtonGroups = []
    }
}

/// The page says which verses are picked (their text, or "" when none).
private final class PickedBridge: NSObject, WKScriptMessageHandler {
    private weak var owner: BibleViewController?
    init(_ owner: BibleViewController) { self.owner = owner }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == BibleViewController.host,
              let text = message.body as? String, text.count <= 200_000 else { return }
        owner?.pickedText = text
    }
}


/// TEMPORARY, TestFlight builds on a Mac only: a short timeline of what the
/// app saw (coming back to full screen, recording a prayer), copied to the
/// clipboard to be pasted back to us. Remove once both are understood.
enum MacReport {
    static let on = ProcessInfo.processInfo.isiOSAppOnMac
        && Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
    private static var lines: [String] = []
    private static var started = Date()

    static func start() {
        guard on else { return }
        lines = []; started = Date()
    }

    static func note(_ line: String) {
        guard on else { return }
        lines.append(String(format: "%6.0f ms  ", Date().timeIntervalSince(started) * 1000) + line)
        if lines.count > 200 { lines.removeFirst(lines.count - 200) }
    }

    static func copy(title: String) {
        guard on, !lines.isEmpty else { return }
        UIPasteboard.general.string = (["Quiet Bible \(title) report"] + lines).joined(separator: "\n")
    }
}
