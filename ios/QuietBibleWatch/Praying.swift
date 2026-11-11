import AVFoundation
import WatchKit

/// Records one prayer at a time.
///
/// While recording, a mindfulness session keeps the app running when the
/// wrist goes down (hands folded), for up to an hour. Without it the watch
/// would stop the microphone as soon as the screen sleeps.
final class Praying: NSObject, ObservableObject, AVAudioRecorderDelegate, WKExtendedRuntimeSessionDelegate {
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
    private var runtime: WKExtendedRuntimeSession?
    private var amenTimer: Timer?

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
        guard !isRecording else { return }
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            record()
        case .undetermined:
            AVAudioApplication.requestRecordPermission { ok in
                DispatchQueue.main.async {
                    if ok { self.record() } else { self.phase = .needsMic }
                }
            }
        default:
            phase = .needsMic
        }
    }

    private func record() {
        amenTimer?.invalidate()
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
            // The tap comes first, so the recording doesn't start with its buzz.
            WKInterfaceDevice.current().play(.start)
            guard r.record(forDuration: 59 * 60) else { throw CocoaError(.fileWriteUnknown) }
            recorder = r
            self.id = id
            started = now
            phase = .recording(since: now)
            keepRunning()
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
        runtime?.invalidate()
        runtime = nil
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

    /// The screen went dark and nothing keeps the app running: keep what was said.
    func wentAway() {
        if runtime?.state != .running { amen() }
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

    // MARK: Staying awake with the wrist down

    private func keepRunning() {
        let s = WKExtendedRuntimeSession()
        s.delegate = self
        s.start()
        runtime = s
    }

    func extendedRuntimeSessionDidStart(_ s: WKExtendedRuntimeSession) {}

    func extendedRuntimeSessionWillExpire(_ s: WKExtendedRuntimeSession) {
        DispatchQueue.main.async { self.amen() }
    }

    func extendedRuntimeSession(_ s: WKExtendedRuntimeSession,
                                didInvalidateWith reason: WKExtendedRuntimeSessionInvalidationReason,
                                error: Error?) {
        DispatchQueue.main.async {
            if self.runtime === s { self.runtime = nil }
        }
    }
}
