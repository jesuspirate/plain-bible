import Foundation
import Security
#if canImport(WidgetKit)
import WidgetKit
#endif

/// What the iPhone app, its notification extension (QuietBibleNotify) and
/// its Home Screen widget (QuietBibleHome) share: the circles' names (sealed
/// on the server, so only this phone knows them), the notification's words
/// in the app's language, which circles have something new, and the 🙏
/// picked in the app. Nothing else.
///
/// Kept as one small item in the keychain, in a group the three share
/// (keychain-access-groups in their entitlements). An App Group would be the
/// usual place, but Apple's signing key can't create one, so the App Store
/// build would need someone to sign in at developer.apple.com. The keychain
/// group needs nothing set up, and the item can be read while the phone is
/// locked (after its first unlock), which a notification needs.
enum SharedCircles {
    /// The team's prefix and the shared group, as in the entitlements.
    private static let group = "VBV7MKN8BZ.com.myquietbible.ios.shared"
    private static let service = "com.myquietbible.ios.circles"

    private static let namesKey = "circleNames", wordsKey = "circleWords", newsKey = "circleNews", toneKey = "prayTone"

    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: "shared",
         kSecAttrAccessGroup as String: group]
    }

    private static func load() -> [String: Any] {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data,
              let all = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return all
    }

    private static func save(_ all: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: all) else { return }
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var q = query
            q[kSecValueData as String] = data
            q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(q as CFDictionary, nil)
        }
    }

    private static func set(_ key: String, _ value: Any?) {
        var all = load()
        all[key] = value
        save(all)
    }

    /// Circle ids are letters, digits, - and _ (as on the server).
    static func safe(_ id: String) -> Bool {
        (8...40).contains(id.count) && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") }
    }

    static var names: [String: String] {
        get { load()[namesKey] as? [String: String] ?? [:] }
        set { set(namesKey, newValue) }
    }

    /// "title": "Something new in {circle}", "other": "Something new in your circle".
    static var words: [String: String] {
        get { load()[wordsKey] as? [String: String] ?? [:] }
        set { set(wordsKey, newValue) }
    }

    /// The circles with something new, newest first.
    static var news: [String] {
        get { load()[newsKey] as? [String] ?? [] }
        set { set(newsKey, Array(newValue.prefix(20))) }
    }

    /// The 🙏 with its skin tone ("" for the plain yellow one).
    static var tone: String {
        get { load()[toneKey] as? String ?? "" }
        set { set(toneKey, newValue) }
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
        var all = load()
        for k in [namesKey, wordsKey, newsKey] { all[k] = nil }
        save(all)
        refreshWidgets()
    }

    static func refreshWidgets() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }
}
