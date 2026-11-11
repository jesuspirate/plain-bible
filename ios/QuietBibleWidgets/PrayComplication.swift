import SwiftUI
import WidgetKit

/// The 🙏 on the watch face (and in the Smart Stack). One tap opens the watch
/// app straight into a prayer. It never changes, so it asks for no updates.
struct PrayEntry: TimelineEntry {
    let date: Date
}

struct PrayProvider: TimelineProvider {
    func placeholder(in context: Context) -> PrayEntry { PrayEntry(date: .now) }

    func getSnapshot(in context: Context, completion: @escaping (PrayEntry) -> Void) {
        completion(PrayEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PrayEntry>) -> Void) {
        completion(Timeline(entries: [PrayEntry(date: .now)], policy: .never))
    }
}

struct PrayFace: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryCorner:
            Text("🙏")
                .font(.title2)
                .widgetLabel { Text("Pray") }
        case .accessoryInline:
            Text("🙏 ") + Text("Pray")
        case .accessoryRectangular:
            HStack(spacing: 8) {
                Text("🙏").font(.title)
                VStack(alignment: .leading) {
                    Text("Pray").font(.headline)
                    Text("My Quiet Bible").font(.caption2).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
        default:
            ZStack {
                AccessoryWidgetBackground()
                Text("🙏").font(.title2)
            }
        }
    }
}

@main
struct PrayComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "pray", provider: PrayProvider()) { _ in
            PrayFace()
                .containerBackground(for: .widget) { Color.clear }
                .widgetURL(URL(string: "quietbible://pray"))
        }
        .configurationDisplayName("Pray")
        .description("Tap to start a prayer.")
        .supportedFamilies([.accessoryCircular, .accessoryCorner, .accessoryInline, .accessoryRectangular])
    }
}
