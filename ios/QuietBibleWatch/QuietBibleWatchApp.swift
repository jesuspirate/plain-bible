import SwiftUI

/// My Quiet Bible on Apple Watch: one 🙏 button that records a spoken prayer
/// and sends it to the iPhone app, where it joins "Your prayers".
@main
struct QuietBibleWatchApp: App {
    @StateObject private var praying = Praying()

    init() {
        Outbox.shared.start()
    }

    var body: some Scene {
        WindowGroup {
            PrayView()
                .environmentObject(praying)
                .environmentObject(Outbox.shared)
                // The 🙏 on the watch face opens straight into a prayer.
                .onOpenURL { url in
                    if url.host == "pray" { praying.begin() }
                }
                // For ios/watch-smoke.sh, which can't tap: start a prayer on launch.
                .task {
                    guard ProcessInfo.processInfo.arguments.contains("-startPraying") else { return }
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                    praying.begin()
                }
        }
    }
}
