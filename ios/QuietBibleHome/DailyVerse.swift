import AppIntents
import SwiftUI
import WidgetKit

// The verse of the day on the Home Screen and the Lock Screen: one short,
// well-loved verse a day, read in your Bible (or, if you pick it, one of
// your own highlighted and bookmarked verses). Tapping it opens that verse
// in the app. The app hands the verses over (Shared/SharedVerses.swift); the
// widget only turns the page at midnight. Not a plan: nothing to keep up with.

/// Where the verses come from, picked by holding the widget → Edit Widget.
enum VerseSource: String, AppEnum {
    case wellLoved, saved

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Verses"
    static let caseDisplayRepresentations: [VerseSource: DisplayRepresentation] = [
        .wellLoved: "Well-loved verses",
        .saved: "My saved verses",
    ]
}

struct DailyVerseIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Verse of the day"

    @Parameter(title: "Verses", default: .wellLoved)
    var source: VerseSource
}

struct VerseEntry: TimelineEntry {
    let date: Date
    /// None until the app has been opened once with this widget's version.
    var verse: SharedVerses.Verse?
    /// The picture in the widget gallery, before there's anything real.
    var sample = false

    static func sample(_ date: Date = .now) -> VerseEntry { VerseEntry(date: date, verse: nil, sample: true) }
}

struct VerseProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> VerseEntry { .sample() }

    func snapshot(for configuration: DailyVerseIntent, in context: Context) async -> VerseEntry {
        let v = SharedVerses.verse(on: .now, saved: configuration.source == .saved)
        return v == nil ? .sample() : VerseEntry(date: .now, verse: v)
    }

    /// Today, and the next two days from midnight; then iOS asks again.
    func timeline(for configuration: DailyVerseIntent, in context: Context) async -> Timeline<VerseEntry> {
        let all = SharedVerses.load()
        let saved = configuration.source == .saved
        let today = Calendar.current.startOfDay(for: .now)
        var entries = [VerseEntry(date: .now, verse: SharedVerses.verse(on: .now, saved: saved, from: all))]
        for n in 1...2 {
            guard let day = Calendar.current.date(byAdding: .day, value: n, to: today) else { break }
            entries.append(VerseEntry(date: day, verse: SharedVerses.verse(on: day, saved: saved, from: all)))
        }
        return Timeline(entries: entries, policy: .atEnd)
    }
}

private func hex(_ v: UInt32) -> Color {
    Color(red: Double((v >> 16) & 0xff) / 255, green: Double((v >> 8) & 0xff) / 255, blue: Double(v & 0xff) / 255)
}

/// The verse as the widget shows it, or the sample (Psalm 119:105) in the
/// iPhone's language, or a word to open the app first.
struct VerseWords {
    let text: Text
    let ref: Text?

    init(_ entry: VerseEntry) {
        if let v = entry.verse {
            text = Text(verbatim: v.t); ref = Text(verbatim: v.l)
        } else if entry.sample {
            text = Text("Thy word is a lamp unto my feet, and a light unto my path.")
            ref = Text("Psalm 119:105")
        } else {
            text = Text("Open My Quiet Bible once to see today’s verse.")
            ref = nil
        }
    }
}

/// Every size, drawn for `family` (given, so pictures can be made of each).
struct VerseCard: View {
    let entry: VerseEntry
    let family: WidgetFamily
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let w = VerseWords(entry)
        switch family {
        case .accessoryInline:
            if let ref = w.ref { ref + Text(verbatim: " · ") + w.text } else { w.text }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                if let ref = w.ref { ref.font(.headline).widgetAccentable().lineLimit(1) }
                w.text.font(.system(.body, design: .serif)).lineLimit(w.ref == nil ? 3 : 2)
                    .minimumScaleFactor(0.85)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            let c = Palette(scheme)
            let size: CGFloat = family == .systemLarge ? 28 : family == .systemMedium ? 21 : 18
            VStack(alignment: .leading, spacing: 8) {
                w.text
                    .font(.system(size: size, design: .serif))
                    .foregroundStyle(c.ink)
                    .lineSpacing(size * 0.12)
                    .minimumScaleFactor(0.5)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                if let ref = w.ref {
                    ref.font(.system(size: family == .systemLarge ? 20 : 15, weight: .semibold))
                        .foregroundStyle(scheme == .dark ? hex(0xe0a96d) : hex(0x8a5a2b))
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
            }
        }
    }
}

struct VerseFace: View {
    let entry: VerseEntry
    @Environment(\.widgetFamily) private var family
    var body: some View { VerseCard(entry: entry, family: family) }
}

struct DailyVerseWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: SharedVerses.kind, intent: DailyVerseIntent.self, provider: VerseProvider()) { entry in
            VerseFace(entry: entry)
                .containerBackground(for: .widget) { Paper() }
                .widgetURL(entry.verse?.link)
        }
        .configurationDisplayName("Verse of the day")
        .description("A verse each day, read in your Bible.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryInline])
    }
}
