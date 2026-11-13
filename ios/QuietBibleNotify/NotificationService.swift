import UserNotifications

/// Runs on the phone when a circle notification arrives, before it shows.
/// The server only says which circle; this puts the circle's name in
/// ("Something new in Family") from the phone's own copy, in the app's
/// language, and lets the Home Screen widget know.
final class NotificationService: UNNotificationServiceExtension {
    private var done: ((UNNotificationContent) -> Void)?
    private var best: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest,
                             withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        done = contentHandler
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            return contentHandler(request.content)
        }
        best = content
        if let circle = content.userInfo["c"] as? String, SharedCircles.safe(circle) {
            if let title = SharedCircles.title(for: circle) {
                // One line, as on the website: the words are the whole notice.
                content.title = ""
                content.body = title
            }
            content.threadIdentifier = circle
            SharedCircles.arrived(circle)
        }
        contentHandler(content)
    }

    override func serviceExtensionTimeWillExpire() {
        if let done, let best { done(best) }
    }
}
