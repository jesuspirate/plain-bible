import AVFoundation
import WebKit

/// Recording prayers where the web view can't.
///
/// On a Mac (the iPad app running there), the web view has no microphone
/// for pages: no `navigator.mediaDevices.getUserMedia` and no
/// `MediaRecorder`, so the prayer button only said "This browser can't
/// record audio". The script below fills in just those two, the way the
/// page already uses them, and the app records with the system's own
/// recorder (AAC in an .m4a, mono, 64 kbit/s, like the page asks for).
/// Where the web view can record (iPhone, iPad) the script stops at its
/// first line and nothing here runs.
final class PrayerMicBridge: NSObject, WKScriptMessageHandlerWithReply, AVAudioRecorderDelegate {
    static let name = "prayermic"
    static let script = WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true)

    /// Set once the web view exists, to tell the page when the microphone
    /// is taken away (a call, another app).
    weak var web: WKWebView?
    private var recorder: AVAudioRecorder?
    private var file: URL?
    private var before: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?
    private var interruption: NSObjectProtocol?
    /// The page waiting for the finished file, and the loudest moment heard.
    private var finished: ((URL?) -> Void)?
    private var loudest: Float = -160
    private var meter: Timer?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == BibleViewController.host,
              let body = message.body as? [String: Any], let op = body["op"] as? String else {
            return replyHandler(nil, "no")
        }
        switch op {
        case "open": askForMicrophone { replyHandler($0, nil) }
        case "start": replyHandler(start() ? "ok" : "error", nil)
        case "pause": recorder?.pause(); replyHandler("ok", nil)
        case "resume": recorder?.record(); replyHandler("ok", nil)
        case "stop":
            guard let recorder, let file else { return replyHandler("", nil) }
            let seconds = recorder.currentTime
            meter?.invalidate(); meter = nil
            self.recorder = nil; self.file = nil
            // The file is only whole (its index written at the end) once the
            // recorder says it has finished: 1.2.8 read it straight after
            // stop() and handed the page a file nothing could play. Wait for
            // that, 3 seconds at most.
            var answered = false
            let answer: (URL?) -> Void = { [weak self] url in
                guard !answered else { return }
                answered = true
                self?.finished = nil
                self?.letGo()
                DispatchQueue.global(qos: .userInitiated).async {
                    let data = url.flatMap { try? Data(contentsOf: $0) } ?? Data()
                    try? FileManager.default.removeItem(at: file)
                    DispatchQueue.main.async {
                        MacReport.note("prayer: \(String(format: "%.1f", seconds)) s, \(data.count) bytes, loudest \(String(format: "%.0f", self?.loudest ?? -160)) dB, input \(Self.inputName())")
                        MacReport.copy(title: "prayer")
                        replyHandler(data.base64EncodedString(), nil)
                    }
                }
            }
            finished = answer
            recorder.stop()
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { answer(file) }
        case "release": discard(); replyHandler("ok", nil)
        default: replyHandler(nil, "no")
        }
    }

    private func askForMicrophone(_ answer: @escaping (String) -> Void) {
        let done: (Bool) -> Void = { ok in DispatchQueue.main.async { answer(ok ? "ok" : "denied") } }
        if #available(iOS 17.0, *) {
            switch AVAudioApplication.shared.recordPermission {
            case .granted: done(true)
            case .denied: done(false)
            default: AVAudioApplication.requestRecordPermission(completionHandler: done)
            }
        } else {
            switch AVAudioSession.sharedInstance().recordPermission {
            case .granted: done(true)
            case .denied: done(false)
            default: AVAudioSession.sharedInstance().requestRecordPermission(done)
            }
        }
    }

    private func start() -> Bool {
        discard()
        let session = AVAudioSession.sharedInstance()
        // The web view sets the session for reading aloud; put it back after.
        before = (session.category, session.mode, session.categoryOptions)
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("prayer-\(UUID().uuidString).m4a")
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try session.setActive(true)
            let made = try AVAudioRecorder(url: url, settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 44_100,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 64_000,
            ])
            made.delegate = self
            made.isMeteringEnabled = true
            guard made.record() else { throw CocoaError(.fileWriteUnknown) }
            recorder = made; file = url
            loudest = -160
            MacReport.start()
            MacReport.note("prayer: recording to \(Self.inputName())")
            meter = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self, weak made] _ in
                guard let self, let made else { return }
                made.updateMeters()
                self.loudest = max(self.loudest, made.peakPower(forChannel: 0))
            }
            interruption = NotificationCenter.default.addObserver(
                forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] note in
                guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                      AVAudioSession.InterruptionType(rawValue: raw) == .began else { return }
                // The page stops and keeps what it has, as with a phone call.
                self?.web?.evaluateJavaScript("dispatchEvent(new Event('quietbible:mic-ended'))")
            }
            return true
        } catch {
            try? FileManager.default.removeItem(at: url)
            letGo()
            return false
        }
    }

    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        MacReport.note("prayer: finished, ok \(flag)")
        finished?(recorder.url)
    }

    func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        MacReport.note("prayer: encode error \(error.map { "\($0)" } ?? "none")")
    }

    private static func inputName() -> String {
        let route = AVAudioSession.sharedInstance().currentRoute.inputs
        return route.isEmpty ? "no input" : route.map { "\($0.portName) (\($0.portType.rawValue))" }.joined(separator: ", ")
    }

    /// Stop without keeping anything.
    private func discard() {
        meter?.invalidate(); meter = nil
        guard let recorder else { return }
        recorder.stop()
        recorder.deleteRecording()
        self.recorder = nil; file = nil
        letGo()
    }

    private func letGo() {
        if let interruption { NotificationCenter.default.removeObserver(interruption) }
        interruption = nil
        let session = AVAudioSession.sharedInstance()
        try? session.setActive(false, options: .notifyOthersOnDeactivation)
        if let before { try? session.setCategory(before.0, mode: before.1, options: before.2) }
        before = nil
    }

    // MARK: The page's side

    /// Runs before the page's own code. Where the web view can record, it
    /// stops at the first line.
    private static let js = #"""
    (() => {
      const native = window.webkit && webkit.messageHandlers && webkit.messageHandlers.prayermic
      if (!native || (typeof MediaRecorder !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return
      const ask = op => native.postMessage({ op })

      let live = null
      class Track extends EventTarget {
        constructor() { super(); this.kind = 'audio'; this.readyState = 'live'; this.enabled = true; this.muted = false; this.onended = null; this.onmute = null; this.onunmute = null }
        stop() { if (this.readyState === 'ended') return; this.readyState = 'ended'; ask('release').catch(() => {}) }
      }
      class Stream {
        constructor(track) { this.track = track; this.active = true }
        getTracks() { return [this.track] }
        getAudioTracks() { return [this.track] }
        getVideoTracks() { return [] }
      }
      addEventListener('quietbible:mic-ended', () => {
        const t = live
        if (!t || t.readyState !== 'live') return
        t.readyState = 'ended'
        const e = new Event('ended')
        if (t.onended) t.onended(e)
        t.dispatchEvent(e)
      })

      const devices = navigator.mediaDevices || {}
      if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: devices, configurable: true })
      devices.getUserMedia = async want => {
        if (!want || !want.audio || want.video) throw new DOMException('Only a microphone here', 'NotSupportedError')
        const r = await ask('open')
        if (r === 'denied') throw new DOMException('The microphone is not allowed', 'NotAllowedError')
        if (r !== 'ok') throw new DOMException('No microphone', 'NotFoundError')
        return new Stream(live = new Track())
      }

      class Recorder extends EventTarget {
        constructor(stream) {
          super(); this.stream = stream; this.mimeType = 'audio/mp4'; this.state = 'inactive'
          this.ondataavailable = null; this.onstop = null; this.onerror = null; this.onstart = null
          this.onpause = null; this.onresume = null
        }
        static isTypeSupported(type) { return /^audio\/mp4/.test(type) }
        fire(name, e = new Event(name)) { const f = this['on' + name]; if (f) f.call(this, e); this.dispatchEvent(e) }
        start() {
          if (this.state !== 'inactive') throw new DOMException('Already recording', 'InvalidStateError')
          this.state = 'recording'
          ask('start').then(r => {
            if (r !== 'ok') throw new Error(r)
            this.fire('start')
          }).catch(() => {
            if (this.state === 'inactive') return
            this.state = 'inactive'; this.fire('error'); this.fire('stop')
          })
        }
        pause() { if (this.state !== 'recording') return; this.state = 'paused'; ask('pause').catch(() => {}); this.fire('pause') }
        resume() { if (this.state !== 'paused') return; this.state = 'recording'; ask('resume').catch(() => {}); this.fire('resume') }
        requestData() {}
        stop() {
          if (this.state === 'inactive') return
          this.state = 'inactive'
          ask('stop').then(b64 => {
            const raw = atob(String(b64 || ''))
            const out = new Uint8Array(raw.length)
            for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
            return new Blob([out], { type: 'audio/mp4' })
          }, () => new Blob([], { type: 'audio/mp4' })).then(data => {
            const e = new Event('dataavailable'); e.data = data
            this.fire('dataavailable', e)
            this.fire('stop')
          })
        }
      }
      window.MediaRecorder = Recorder
    })()
    """#
}
