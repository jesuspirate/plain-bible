import SwiftUI
import WidgetKit

// The Home Screen (and Lock Screen) widgets of the iPhone app. Each one is
// only a button or two: 🙏 opens the app straight on the prayer screen, the
// three people open Circles. Nothing to read, nothing that changes, so they
// never ask iOS for updates. The app handles the links in SceneDelegate.swift.

enum WidgetLink {
    static let pray = URL(string: "quietbible://pray")!
    static let circles = URL(string: "quietbible://circles")!
}

struct StillEntry: TimelineEntry {
    let date: Date
}

struct StillProvider: TimelineProvider {
    func placeholder(in context: Context) -> StillEntry { StillEntry(date: .now) }

    func getSnapshot(in context: Context, completion: @escaping (StillEntry) -> Void) {
        completion(StillEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StillEntry>) -> Void) {
        completion(Timeline(entries: [StillEntry(date: .now)], policy: .never))
    }
}

// MARK: Colors (the app's Sepia theme, and its Dark theme at night)

private func rgb(_ hex: UInt32) -> Color {
    Color(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255)
}

struct Palette {
    let paper: Color, surface: Color, ink: Color, line: Color

    init(_ scheme: ColorScheme) {
        if scheme == .dark {
            paper = rgb(0x16161a); surface = rgb(0x1f1f24); ink = rgb(0xe6e3dc); line = rgb(0x2f2f36)
        } else {
            paper = rgb(0xf4ecd8); surface = rgb(0xfbf5e6); ink = rgb(0x3b2f22); line = rgb(0xe0d3b6)
        }
    }
}

struct Paper: View {
    @Environment(\.colorScheme) private var scheme
    var body: some View { Palette(scheme).paper }
}

// MARK: The two buttons, drawn as in the app's bottom bar

/// 🙏 on its glowing gold disc.
struct PrayDisc: View {
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .fill(RadialGradient(colors: [rgb(0xfffdf6), rgb(0xfff1cc), rgb(0xffd98a)],
                                     center: UnitPoint(x: 0.5, y: 0.4), startRadius: 0, endRadius: size * 0.6))
                .overlay(Circle().stroke(rgb(0xf0b95a).opacity(0.6), lineWidth: 1))
                .shadow(color: rgb(0xf5be5f).opacity(0.55), radius: size * 0.1)
            Text(verbatim: "🙏").font(.system(size: size * 0.5))
        }
        .frame(width: size, height: size)
    }
}

/// The app's Circles mark (src/icons.tsx, CircleIcon): three people in a ring.
struct CirclesMark: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 24
        let ox = rect.midX - 12 * s, oy = rect.midY - 12 * s
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * s, y: oy + y * s) }
        func ring(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat) -> CGRect {
            CGRect(x: ox + (x - r) * s, y: oy + (y - r) * s, width: 2 * r * s, height: 2 * r * s)
        }
        var path = Path()
        path.addEllipse(in: ring(12, 7, 3))
        path.addEllipse(in: ring(5.5, 15.5, 2.6))
        path.addEllipse(in: ring(18.5, 15.5, 2.6))
        path.move(to: p(8.2, 20.5)); path.addQuadCurve(to: p(15.8, 20.5), control: p(12, 22.96))
        path.move(to: p(7.2, 10.6)); path.addQuadCurve(to: p(5.6, 12.9), control: p(6.15, 11.57))
        path.move(to: p(16.8, 10.6)); path.addQuadCurve(to: p(18.4, 12.9), control: p(17.85, 11.57))
        return path
    }
}

/// The three people on a plain round button.
struct CirclesDisc: View {
    let size: CGFloat
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let c = Palette(scheme)
        ZStack {
            Circle().fill(c.surface).overlay(Circle().stroke(c.line, lineWidth: 1))
            CirclesMark()
                .stroke(c.ink, style: StrokeStyle(lineWidth: size * 0.6 / 24 * 2.6, lineCap: .round))
                .frame(width: size * 0.6, height: size * 0.6)
        }
        .frame(width: size, height: size)
    }
}

/// A button with its name under it.
struct Labeled<Disc: View>: View {
    let name: LocalizedStringKey
    let disc: Disc
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        VStack(spacing: 8) {
            disc
            Text(name)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Palette(scheme).ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }
}

// MARK: Pray (small Home Screen, and the Lock Screen)

struct PrayFace: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryInline:
            Text(verbatim: "🙏 ") + Text("Pray")
        case .accessoryRectangular:
            HStack(spacing: 8) {
                Text(verbatim: "🙏").font(.title)
                VStack(alignment: .leading) {
                    Text("Pray").font(.headline)
                    Text("My Quiet Bible").font(.caption2).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Text(verbatim: "🙏").font(.title2)
            }
        default:
            Labeled(name: "Pray", disc: PrayDisc(size: 78))
        }
    }
}

struct PrayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "pray", provider: StillProvider()) { _ in
            PrayFace()
                .containerBackground(for: .widget) { Paper() }
                .widgetURL(WidgetLink.pray)
        }
        .configurationDisplayName("Pray")
        .description("Tap to start a prayer.")
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: Circles (small Home Screen, and the Lock Screen)

struct CirclesFace: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                CirclesMark()
                    .stroke(style: StrokeStyle(lineWidth: 2.4, lineCap: .round))
                    .padding(9)
            }
        default:
            Labeled(name: "Circles", disc: CirclesDisc(size: 74))
        }
    }
}

struct CirclesWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "circles", provider: StillProvider()) { _ in
            CirclesFace()
                .containerBackground(for: .widget) { Paper() }
                .widgetURL(WidgetLink.circles)
        }
        .configurationDisplayName("Circles")
        .description("Tap to share with your circles.")
        .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}

// MARK: Pray and Circles (medium and large Home Screen)

struct BothFace: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        if family == .systemLarge {
            VStack(spacing: 18) {
                Text("My Quiet Bible")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Palette(scheme).ink.opacity(0.7))
                Spacer(minLength: 0)
                Link(destination: WidgetLink.pray) { Labeled(name: "Pray", disc: PrayDisc(size: 150)) }
                Spacer(minLength: 0)
                Link(destination: WidgetLink.circles) { CirclesBar() }
            }
        } else {
            // The app's order: Circles on the left, 🙏 on the right.
            HStack(spacing: 0) {
                Link(destination: WidgetLink.circles) {
                    Labeled(name: "Circles", disc: CirclesDisc(size: 70)).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                Link(destination: WidgetLink.pray) {
                    Labeled(name: "Pray", disc: PrayDisc(size: 78)).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
    }
}

/// Circles as one wide button, under the big 🙏.
struct CirclesBar: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let c = Palette(scheme)
        HStack(spacing: 12) {
            CirclesMark()
                .stroke(c.ink, style: StrokeStyle(lineWidth: 2.6 * 30 / 24, lineCap: .round))
                .frame(width: 30, height: 30)
            Text("Circles").font(.system(size: 20, weight: .semibold)).foregroundStyle(c.ink)
        }
        .frame(maxWidth: .infinity, minHeight: 64)
        .background(Capsule().fill(c.surface).overlay(Capsule().stroke(c.line, lineWidth: 1)))
    }
}

struct BothWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "pray-circles", provider: StillProvider()) { _ in
            BothFace()
                .containerBackground(for: .widget) { Paper() }
        }
        .configurationDisplayName("Pray and Circles")
        .description("Pray, or share with your circles.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

@main
struct HomeWidgets: WidgetBundle {
    var body: some Widget {
        PrayWidget()
        BothWidget()
        CirclesWidget()
    }
}
