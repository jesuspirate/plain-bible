import Foundation
import Security
#if canImport(WidgetKit)
import WidgetKit
#endif

/// The verse of the day, as the web app hands it over (src/lib/dailyVerse.ts)
/// for the Home Screen widget (QuietBibleHome/DailyVerse.swift): a month of
/// days ahead, each with its verse read in your Bible and named in the app's
/// language, and your saved verses (highlights and bookmarks).
///
/// Kept in the keychain group the app and its widget already share (see
/// SharedCircles.swift for why not an App Group), as its own small item.
enum SharedVerses {
    static let kind = "daily-verse"

    struct Verse: Codable, Equatable {
        /// "Psalm 119:105"
        var l: String
        /// The words, in your Bible.
        var t: String
        /// Where it opens in the app: "read/KJV/Ps/119?v=105".
        var p: String
        /// The day it is for (days since 1970 by the calendar), or none.
        var d: Int?

        var link: URL? { URL(string: "quietbible://" + p) }
    }

    struct All: Codable, Equatable {
        var days: [Verse] = []
        var saved: [Verse] = []
    }

    private static let group = "VBV7MKN8BZ.com.myquietbible.ios.shared"
    private static let service = "com.myquietbible.ios.verses"

    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: "verses",
         kSecAttrAccessGroup as String: group]
    }

    static func load() -> All {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data,
              let all = try? JSONDecoder().decode(All.self, from: data) else { return All() }
        return all
    }

    /// Keep what the web app sent; the widget is redrawn only when it changed.
    static func save(_ all: All) {
        guard all != load(), let data = try? JSONEncoder().encode(all) else { return }
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var q = query
            q[kSecValueData as String] = data
            q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(q as CFDictionary, nil)
        }
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadTimelines(ofKind: kind)
        #endif
    }

    /// A place in the app, as the web app names it: read/<Bible>/<book>/<chapter>?v=<verse>.
    static func safePlace(_ p: String) -> Bool {
        p.range(of: #"^read/[A-Za-z0-9_.-]{1,40}/[A-Za-z0-9]{1,12}/[0-9]{1,3}\?v=[0-9]{1,3}$"#, options: .regularExpression) != nil
    }

    /// The web app's message, checked: anything odd is left out.
    static func from(_ body: [String: Any]) -> All {
        func list(_ key: String, max: Int) -> [Verse] {
            guard let raw = body[key] as? [[String: Any]] else { return [] }
            return raw.prefix(max).compactMap { x in
                guard let l = x["l"] as? String, let t = x["t"] as? String, let p = x["p"] as? String,
                      (1...80).contains(l.count), (1...600).contains(t.count), safePlace(p) else { return nil }
                return Verse(l: l, t: t, p: p, d: (x["d"] as? NSNumber)?.intValue)
            }
        }
        return All(days: list("days", max: 40), saved: list("saved", max: 40))
    }

    /// Days since 1970 by the calendar here, as the web app counts them.
    static func dayNumber(_ date: Date) -> Int {
        var here = Calendar(identifier: .gregorian)
        here.timeZone = .current
        let c = here.dateComponents([.year, .month, .day], from: date)
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC")!
        guard let start = utc.date(from: c) else { return 0 }
        return Int((start.timeIntervalSince1970 / 86400).rounded(.down))
    }

    /// The verse for that day: from your saved verses when asked and there
    /// are some, else the day's own (or, past the month handed over, round
    /// the ones there are).
    static func verse(on date: Date, saved: Bool, from all: All = load()) -> Verse? {
        let day = dayNumber(date)
        func round(_ list: [Verse]) -> Verse { list[((day % list.count) + list.count) % list.count] }
        if saved, !all.saved.isEmpty { return round(all.saved) }
        if let v = all.days.first(where: { $0.d == day }) { return v }
        return all.days.isEmpty ? nil : round(all.days)
    }
}
