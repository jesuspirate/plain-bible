import UIKit
import SwiftUI
import WidgetKit

// Draws the verse-of-the-day widget at iPhone sizes, so a change can be
// looked at without a phone (widget-pictures.sh, run by widget-pictures.yml).
// The words are as the app would hand them over from its Bibles.

let kjv = SharedVerses.Verse(l: "Psalm 46:10", t: "Be still, and know that I am God: I will be exalted among the heathen, I will be exalted in the earth.", p: "read/KJV/Ps/46?v=10")
let john = SharedVerses.Verse(l: "John 3:16", t: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.", p: "read/KJV/John/3?v=16")
let lamp = SharedVerses.Verse(l: "Psalm 119:105", t: "Thy word is a lamp unto my feet, and a light unto my path.", p: "read/KJV/Ps/119?v=105")
let lsg = SharedVerses.Verse(l: "Psaume 46:10", t: "Arrêtez, et sachez que je suis Dieu: Je domine sur les nations, je domine sur la terre.", p: "read/LSG/Ps/46?v=10")
let rv = SharedVerses.Verse(l: "Salmo 46:10", t: "Estad quietos, y conoced que yo soy Dios: Ensalzado he de ser entre las gentes, ensalzado seré en la tierra.", p: "read/SpaRV/Ps/46?v=10")

func entry(_ v: SharedVerses.Verse) -> VerseEntry { VerseEntry(date: .now, verse: v) }

/// A Home Screen widget at its iPhone size, on its paper.
struct Home: View {
    let v: SharedVerses.Verse
    let family: WidgetFamily
    let dark: Bool
    var body: some View {
        let size: CGSize = family == .systemSmall ? CGSize(width: 170, height: 170) : family == .systemMedium ? CGSize(width: 364, height: 170) : CGSize(width: 364, height: 382)
        VerseCard(entry: entry(v), family: family)
            .padding(16)
            .frame(width: size.width, height: size.height)
            .background(Paper())
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .environment(\.colorScheme, dark ? .dark : .light)
    }
}

/// The Lock Screen: white words over a wallpaper.
struct Lock: View {
    var body: some View {
        VStack(spacing: 14) {
            Text("9:41").font(.system(size: 80, weight: .semibold, design: .rounded))
            VerseCard(entry: entry(lamp), family: .accessoryRectangular).frame(width: 160, height: 72)
            VerseCard(entry: entry(lamp), family: .accessoryInline).lineLimit(1).font(.system(size: 15, weight: .medium)).frame(width: 300)
        }
        .foregroundStyle(.white)
        .padding(24)
        .frame(width: 364)
        .background(LinearGradient(colors: [Color(red: 0.16, green: 0.22, blue: 0.36), Color(red: 0.45, green: 0.32, blue: 0.40)], startPoint: .top, endPoint: .bottom))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .environment(\.colorScheme, .dark)
    }
}

struct Caption: View {
    let s: String
    var body: some View { Text(s).font(.system(size: 15, weight: .semibold)).foregroundStyle(.black.opacity(0.6)) }
}

struct Sheet: View {
    var body: some View {
        HStack(alignment: .top, spacing: 28) {
            VStack(alignment: .leading, spacing: 12) {
                Caption(s: "Small and medium (Sepia)")
                HStack(spacing: 24) { Home(v: lamp, family: .systemSmall, dark: false); Home(v: kjv, family: .systemSmall, dark: false) }
                Home(v: john, family: .systemMedium, dark: false)
                Caption(s: "At night (Dark)")
                HStack(spacing: 24) { Home(v: lamp, family: .systemSmall, dark: true); Home(v: kjv, family: .systemSmall, dark: true) }
                Home(v: john, family: .systemMedium, dark: true)
            }
            VStack(alignment: .leading, spacing: 12) {
                Caption(s: "Large")
                Home(v: kjv, family: .systemLarge, dark: false)
                Caption(s: "In French (LSG) and Spanish (RV)")
                Home(v: lsg, family: .systemMedium, dark: false)
                Home(v: rv, family: .systemMedium, dark: false)
            }
            VStack(alignment: .leading, spacing: 12) {
                Caption(s: "Lock Screen")
                Lock()
            }
        }
        .padding(32)
        .background(Color(white: 0.93))
    }
}

/// The Pray and Circles widget (medium: the widget family can't be set
/// outside WidgetKit, and the face draws its medium look by default), the
/// wide Circles bar of the large one, and the Circles mark up close, to hold
/// against the app's own Circles button (src/icons.tsx CircleIcon).
struct Both: View {
    let dark: Bool
    var body: some View {
        BothFace(entry: StillEntry(date: .now))
            .padding(16)
            .frame(width: 364, height: 170)
            .background(Paper())
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .environment(\.colorScheme, dark ? .dark : .light)
    }
}

struct CirclesSheet: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Caption(s: "The Circles mark, up close")
            HStack(spacing: 24) {
                CirclesMark().stroke(Color.black, lineWidth: 2 * 160 / 24).frame(width: 160, height: 160)
                CirclesDisc(size: 160).environment(\.colorScheme, .dark)
                CirclesDisc(size: 160).environment(\.colorScheme, .light)
            }
            Caption(s: "Pray and Circles (Sepia and Dark)")
            HStack(spacing: 24) { Both(dark: false); Both(dark: true) }
            Caption(s: "The Circles bar of the large widget")
            CirclesBar(entry: StillEntry(date: .now)).frame(width: 332).padding(16).background(Paper())
        }
        .padding(32)
        .background(Color(white: 0.93))
    }
}

@MainActor func save(_ view: some View, _ name: String) {
    let r = ImageRenderer(content: view)
    r.scale = 2
    guard let image = r.uiImage, let data = image.pngData() else { fatalError("nothing drawn") }
    try! data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent(name))
    print("drew", name, image.size.width * image.scale, "x", image.size.height * image.scale)
}

@main
struct Render {
    @MainActor static func main() {
        save(Sheet(), "daily-verse-widget.png")
        save(CirclesSheet(), "circles-widget.png")
    }
}
