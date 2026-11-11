import SwiftUI

/// The whole watch app: a big 🙏 to start, a glowing ring and the time while
/// you pray, a big Amen to finish.
struct PrayView: View {
    @EnvironmentObject private var praying: Praying
    @EnvironmentObject private var outbox: Outbox
    @Environment(\.scenePhase) private var scenePhase

    /// The app's leather brown and the thread of gold from its store pictures.
    static let brown = Color(red: 0.45, green: 0.29, blue: 0.16)
    static let gold = Color(red: 0.88, green: 0.66, blue: 0.43)

    var body: some View {
        Group {
            switch praying.phase {
            case .recording(let since):
                recording(since: since)
            case .amen:
                amen
            default:
                ready
            }
        }
        .onChange(of: scenePhase) { _, now in
            if now == .background { praying.wentAway() }
            if now == .active { outbox.send() }
        }
    }

    private var ready: some View {
        VStack(spacing: 6) {
            Button { praying.begin() } label: {
                Text("🙏")
                    .font(.system(size: 64))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Circle().fill(Self.brown.opacity(0.35)))
                    .overlay(Circle().stroke(Self.gold.opacity(0.6), lineWidth: 2))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Pray"))

            Text(caption)
                .font(.footnote)
                .multilineTextAlignment(.center)
                .foregroundStyle(praying.phase == .idle ? .secondary : .primary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 4)
    }

    private var caption: LocalizedStringKey {
        switch praying.phase {
        case .needsMic: return "Allow the microphone for My Quiet Bible in the Settings app on your watch."
        case .failed: return "The prayer couldn’t start. Tap to try again."
        default: return outbox.waiting > 0 ? "Waiting for your iPhone" : "Tap to pray"
        }
    }

    private func recording(since: Date) -> some View {
        VStack(spacing: 8) {
            ZStack {
                Glow()
                Text("🙏").font(.system(size: 44))
            }
            .frame(maxHeight: .infinity)
            .accessibilityHidden(true)

            Text(timerInterval: since...since.addingTimeInterval(60 * 60), countsDown: false)
                .font(.title3.monospacedDigit())
                .foregroundStyle(.secondary)

            Button { praying.amen() } label: {
                Text("Amen")
                    .font(.title3.bold())
                    .frame(maxWidth: .infinity, minHeight: 46)
            }
            .buttonStyle(.borderedProminent)
            .tint(Self.brown)
            .handGestureShortcutIfAvailable()
        }
    }

    private var amen: some View {
        VStack(spacing: 10) {
            Text("🙏").font(.system(size: 44))
            Text("Amen. He heard you.")
                .font(.headline)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { praying.begin() }
    }
}

/// A soft ring of gold that breathes while you pray.
private struct Glow: View {
    @State private var big = false

    var body: some View {
        Circle()
            .stroke(PrayView.gold, lineWidth: 5)
            .shadow(color: PrayView.gold.opacity(0.8), radius: big ? 12 : 4)
            .scaleEffect(big ? 1 : 0.88)
            .opacity(big ? 1 : 0.6)
            .padding(6)
            .onAppear {
                withAnimation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true)) { big = true }
            }
    }
}

private extension View {
    /// Double tap (pinching twice) finishes the prayer, on watches that have it.
    @ViewBuilder func handGestureShortcutIfAvailable() -> some View {
        if #available(watchOS 11.0, *) {
            self.handGestureShortcut(.primaryAction)
        } else {
            self
        }
    }
}
