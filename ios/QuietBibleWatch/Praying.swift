import AVFoundation
import WatchKit

/// Records one prayer at a time.
///
/// The recording carries on when the wrist goes down (hands folded): the
/// watch app is allowed to keep its microphone going in the background
/// (UIBackgroundModes: audio in Info.plist), as voice memo apps are.
final class Praying: NSObject, ObservableObject, AVAudioRecorderDelegate {
    enum Phase: Equatable {
        case idle
        case recording(since: Date)
        case amen
        case needsMic
        case failed
    }

    @Published private(set) var phase: Phase = .idle

    private var recorder: AVAudioRecorder?
    private var id = ""
    private var started = Date()
    private var amenTimer: Timer?
    /// Between the tap and the microphone, while the watch buzzes.
    private var starting = false

    /// Shorter than this is a slip of the finger, not a prayer.
    private static let shortest: TimeInterval = 0.8

    override init() {
        super.init()
        // A call or Siri takes the microphone: keep what was said so far.
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification,
                                               object: nil, queue: .main) { [weak self] note in
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            if raw == AVAudioSession.InterruptionType.began.rawValue { self?.amen() }
        }
    }

    var isRecording: Bool {
        if case .recording = phase { return true }
        return false
    }

    /// Start a prayer (the 🙏 button, or the watch face).
    func begin() {
        guard !isRecording, !starting else { return }
        let audio = AVAudioSession.sharedInstance()
        switch audio.recordPermission {
        case .granted:
            record()
        case .denied:
            phase = .needsMic
        default:
            // The watch asks once. The answer comes back on any thread, and
            // the screen is only ours again a moment later.
            audio.requestRecordPermission { [weak self] ok in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                    guard let self, !self.isRecording, !self.starting else { return }
                    if ok { self.record() } else { self.phase = .needsMic }
                }
            }
        }
    }

    /// Two solid buzzes, so you know without looking that it's listening,
    /// and then the microphone. The buzzes come first: the watch softens
    /// taps while it records, and the prayer shouldn't start with a buzz.
    private func record() {
        amenTimer?.invalidate()
        starting = true
        WKInterfaceDevice.current().play(.notification)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            WKInterfaceDevice.current().play(.notification)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            guard let self else { return }
            self.starting = false
            self.listen()
        }
    }

    private func listen() {
        let now = Date()
        let id = Outbox.newID(now)
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.record, mode: .default)
            try audio.setActive(true)
            // AAC in MP4, the same kind the iPhone records, so every browser plays it.
            let r = try AVAudioRecorder(url: Outbox.shared.audioURL(id), settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 64_000,
            ])
            r.delegate = self
            guard r.record(forDuration: 59 * 60) else { throw CocoaError(.fileWriteUnknown) }
            recorder = r
            self.id = id
            started = now
            phase = .recording(since: now)
        } catch {
            try? FileManager.default.removeItem(at: Outbox.shared.audioURL(id))
            try? AVAudioSession.sharedInstance().setActive(false)
            WKInterfaceDevice.current().play(.failure)
            phase = .failed
        }
    }

    /// Finish the prayer and keep it.
    func amen() {
        guard let r = recorder, isRecording else { return }
        let length = r.currentTime
        recorder = nil
        r.stop()
        finished(length: length)
    }

    private func finished(length: TimeInterval) {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        guard length >= Self.shortest else {
            try? FileManager.default.removeItem(at: Outbox.shared.audioURL(id))
            phase = .idle
            return
        }
        Outbox.shared.keep(id: id, at: started, ms: Int(length * 1000))
        WKInterfaceDevice.current().play(.success)
        phase = .amen
        amenTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: false) { [weak self] _ in
            if self?.phase == .amen { self?.phase = .idle }
        }
    }

    // MARK: Recording

    func audioRecorderDidFinishRecording(_ r: AVAudioRecorder, successfully ok: Bool) {
        // Only when the hour ran out, or the watch stopped it: amen() lets go first.
        DispatchQueue.main.async {
            guard self.recorder === r else { return }
            self.recorder = nil
            self.finished(length: Date().timeIntervalSince(self.started))
        }
    }

    func audioRecorderEncodeErrorDidOccur(_ r: AVAudioRecorder, error: Error?) {
        DispatchQueue.main.async { self.amen() }
    }
}
