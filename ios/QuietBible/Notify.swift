import UIKit
import UserNotifications
import WebKit

/// Circle notifications in the iPhone app: "Something new in Family".
///
/// The website's own notifications (web push) don't exist inside an app, so
/// here they come through Apple's push. The web app asks for this phone's
/// push address when "Notify me" is turned on in a circle, and gives it to
/// the sync service, which only ever says which circle has something new.
/// The circle's name is put in on the phone (QuietBibleNotify), from the
/// copy the web app hands over here.
final class Notify: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notify()
    /// Posted with the circle's id when its notification is tapped.
    static let opened = Notification.Name("QuietBibleCircleOpened")
    /// Posted when one arrives while the app is open.
    static let arrived = Notification.Name("QuietBibleCircleNews")

    private var token: String?
    private var waiting: [(String?) -> Void] = []
    /// A notification tapped before the page was up.
    private(set) var pending: String?

    #if DEBUG
    private static let server = "sandbox"
    #else
    private static let server = "production"
    #endif

    func start() {
        UNUserNotificationCenter.current().delegate = self
        // Already allowed: the address can change, so ask for it at every start.
        UNUserNotificationCenter.current().getNotificationSettings { s in
            if s.authorizationStatus == .authorized {
                DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
            }
        }
    }

    func takePending() -> String? {
        defer { pending = nil }
        return pending
    }

    // MARK: This phone's push address

    /// ["apns": token, "env": server], "denied" when notifications are off
    /// in the iPhone's settings, or nil. `ask`: may show "Allow notifications?".
    func register(ask: Bool, done: @escaping (Any?) -> Void) {
        let center = UNUserNotificationCenter.current()
        center.getNotificationSettings { s in
            switch s.authorizationStatus {
            case .denied:
                DispatchQueue.main.async { done("denied") }
            case .notDetermined:
                guard ask else { return DispatchQueue.main.async { done(nil) } }
                // Quiet by design: a banner, no sound, no number on the icon.
                center.requestAuthorization(options: [.alert]) { ok, _ in
                    DispatchQueue.main.async { ok ? self.address(done) : done("denied") }
                }
            default:
                DispatchQueue.main.async { self.address(done) }
            }
        }
    }

    private func address(_ done: @escaping (Any?) -> Void) {
        let reply: (String?) -> Void = { t in done(t.map { ["apns": $0, "env": Self.server] }) }
        if let token { return reply(token) }
        waiting.append(reply)
        UIApplication.shared.registerForRemoteNotifications()
        // Apple didn't answer (no connection): don't leave the switch spinning.
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            guard let self, self.token == nil else { return }
            self.answer(nil)
        }
    }

    private func answer(_ t: String?) {
        let all = waiting
        waiting = []
        all.forEach { $0(t) }
    }

    func registered(_ data: Data) {
        token = data.map { String(format: "%02x", $0) }.joined()
        answer(token)
    }

    func failed() { answer(nil) }

    // MARK: Notifications

    /// Looking at the circle: its notification has been read.
    func clear(_ circle: String) {
        let center = UNUserNotificationCenter.current()
        center.getDeliveredNotifications { all in
            let ids = all.filter { ($0.request.content.userInfo["c"] as? String) == circle }.map(\.request.identifier)
            if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
        }
    }

    /// One arrives while the app is open: show it, and let the page light its dot.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        NotificationCenter.default.post(name: Self.arrived, object: nil)
        done([.banner, .list])
    }

    /// Tapped: open that circle.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler done: @escaping () -> Void) {
        let c = response.notification.request.content.userInfo["c"] as? String ?? ""
        pending = SharedCircles.safe(c) ? c : ""
        NotificationCenter.default.post(name: Self.opened, object: nil)
        done()
    }
}

/// What the web app asks of the app (src/lib/nativeNotify.ts).
final class NotifyBridge: NSObject, WKScriptMessageHandlerWithReply {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == BibleViewController.host,
              let body = message.body as? [String: Any], let op = body["op"] as? String else {
            return replyHandler(nil, "no")
        }
        switch op {
        case "register":
            Notify.shared.register(ask: body["ask"] as? Bool ?? false) { replyHandler($0, nil) }
        case "clear":
            if let c = body["c"] as? String, SharedCircles.safe(c) { Notify.shared.clear(c) }
            replyHandler(true, nil)
        case "names":
            // The circles' names and the notification's words, in the app's language.
            if let names = body["names"] as? [String: String] {
                SharedCircles.names = names.filter { SharedCircles.safe($0.key) && $0.value.count <= 80 }
            }
            if let words = body["words"] as? [String: String] {
                SharedCircles.words = words.filter { ["title", "other"].contains($0.key) && $0.value.count <= 200 }
            }
            SharedCircles.refreshWidgets()
            replyHandler(true, nil)
        case "news":
            // Which circles have something new: the widget shows it.
            if let ids = body["ids"] as? [String] {
                let now = ids.filter(SharedCircles.safe)
                if now != SharedCircles.news {
                    // Keep the order they arrived in; drop the ones that were read.
                    SharedCircles.news = SharedCircles.news.filter(now.contains) + now.filter { !SharedCircles.news.contains($0) }
                    SharedCircles.refreshWidgets()
                }
            }
            replyHandler(true, nil)
        case "forget":
            SharedCircles.forget()
            replyHandler(true, nil)
        default:
            replyHandler(nil, "unknown")
        }
    }
}
