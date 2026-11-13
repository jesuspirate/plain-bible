import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private let bible = BibleViewController()

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
        guard let scene = scene as? UIWindowScene else { return }
        // Opened from a myquietbible.com link (a verse, a circle invite): start there.
        if let url = options.userActivities.first(where: { $0.activityType == NSUserActivityTypeBrowsingWeb })?.webpageURL {
            bible.open(url)
        }
        // Opened from a Home Screen widget button (quietbible://pray, quietbible://circles).
        if let url = options.urlContexts.first?.url {
            bible.openWidgetLink(url)
        }
        let window = UIWindow(windowScene: scene)
        window.rootViewController = bible
        window.makeKeyAndVisible()
        self.window = window
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        if userActivity.activityType == NSUserActivityTypeBrowsingWeb, let url = userActivity.webpageURL {
            bible.open(url)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        if let url = URLContexts.first?.url {
            bible.openWidgetLink(url)
        }
    }
}
