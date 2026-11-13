import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

/// What the iPhone app, its notification extension (QuietBibleNotify) and
/// its Home Screen widget (QuietBibleHome) share, in their App Group:
/// the circles' names (sealed on the server, so only this phone knows
/// them), the notification's words in the app's language, which circles
/// have something new, and the 🙏 picked in the app. Nothing else.
enum SharedCircles {
    static let group = "group.com.myquietbible.ios"
    private static var store: UserDefaults? { UserDefaults(suiteName: group) }

    private static let namesKey = "circleNames", wordsKey = "circleWords", newsKey = "circleNews", toneKey = "prayTone"

    /// Circle ids are letters, digits, - and _ (as on the server).
    static func safe(_ id: String) -> Bool {
        (8...40).contains(id.count) && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }
    }

    static var names: [String: String] {
        get { store?.dictionary(forKey: namesKey) as? [String: String] ?? [:] }
        set { store?.set(newValue, forKey: namesKey) }
    }

    /// "title": "Something new in {circle}", "other": "Something new in your circle".
    static var words: [String: String] {
        get { store?.dictionary(forKey: wordsKey) as? [String: String] ?? [:] }
        set { store?.set(newValue, forKey: wordsKey) }
    }

    /// The circles with something new, newest first.
    static var news: [String] {
        get { store?.stringArray(forKey: newsKey) ?? [] }
        set { store?.set(Array(newValue.prefix(20)), forKey: newsKey) }
    }

    /// The 🙏 with its skin tone ("" for the plain yellow one).
    static var tone: String {
        get { store?.string(forKey: toneKey) ?? "" }
        set { store?.set(newValue, forKey: toneKey) }
    }

    /// A notification's title: "Something new in Family".
    static func title(for circle: String) -> String? {
        let w = words
        if let name = names[circle], !name.isEmpty {
            return (w["title"] ?? "Something new in {circle}").replacingOccurrences(of: "{circle}", with: name)
        }
        return w["other"]
    }

    /// Something arrived for this circle (from a notification).
    static func arrived(_ circle: String) {
        guard safe(circle) else { return }
        news = [circle] + news.filter { $0 != circle }
        refreshWidgets()
    }

    /// Signed out: nothing of the account stays.
    static func forget() {
        for k in [namesKey, wordsKey, newsKey] { store?.removeObject(forKey: k) }
        refreshWidgets()
    }

    static func refreshWidgets() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }
}
