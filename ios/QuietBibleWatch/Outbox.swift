import Foundation
import WatchConnectivity

/// Prayers recorded on the watch, waiting to reach the iPhone app.
///
/// Each prayer is kept here first (`<id>.m4a` and `<id>.json`), so nothing is
/// lost when the iPhone is out of reach. The watch sends it with
/// WatchConnectivity, which delivers it whenever the iPhone is near, even
/// hours later. Once the iPhone has it, the watch's copy is deleted.
final class Outbox: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = Outbox()

    /// Prayers not yet on the iPhone.
    @Published private(set) var waiting = 0

    private let folder: URL = {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("Prayers", isDirectory: true)
    }()

    func start() {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        count()
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// The same kind of id the app gives a prayer: its start time, and a little chance.
    static func newID(_ at: Date) -> String {
        // Int64, not Int: older watches (up to Series 8 and SE 2) are 32-bit,
        // where a time in milliseconds doesn't fit in an Int and stops the app.
        let ms = Int64(at.timeIntervalSince1970 * 1000)
        let chance = String(Int.random(in: 0..<1_679_616), radix: 36)
        return String(ms, radix: 36) + String(repeating: "0", count: 4 - chance.count) + chance
    }

    func audioURL(_ id: String) -> URL { folder.appendingPathComponent(id + ".m4a") }
    private func infoURL(_ id: String) -> URL { folder.appendingPathComponent(id + ".json") }

    /// A prayer just finished: keep it, and send it.
    func keep(id: String, at: Date, ms: Int) {
        let info: [String: Any] = ["id": id, "at": Int64(at.timeIntervalSince1970 * 1000), "ms": ms, "type": "audio/mp4"]
        if let data = try? JSONSerialization.data(withJSONObject: info) {
            try? data.write(to: infoURL(id), options: .atomic)
        }
        count()
        send()
    }

    /// Send every kept prayer that isn't already on its way.
    func send() {
        let session = WCSession.default
        guard WCSession.isSupported(), session.activationState == .activated else { return }
        let going = Set(session.outstandingFileTransfers.compactMap { $0.file.metadata?["id"] as? String })
        for info in kept() where !going.contains(info.id) {
            let audio = audioURL(info.id)
            guard FileManager.default.fileExists(atPath: audio.path) else { continue }
            session.transferFile(audio, metadata: info.metadata)
        }
    }

    private struct Info { let id: String; let metadata: [String: Any] }

    private func kept() -> [Info] {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "json" }.compactMap { url in
            guard let data = try? Data(contentsOf: url),
                  let meta = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let id = meta["id"] as? String else { return nil }
            return Info(id: id, metadata: meta)
        }
    }

    private func count() {
        let n = kept().count
        DispatchQueue.main.async { self.waiting = n }
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {
        if state == .activated { send() }
    }

    func session(_ session: WCSession, didFinish transfer: WCSessionFileTransfer, error: Error?) {
        // On an error it stays kept, and goes again next time.
        guard error == nil, let id = transfer.file.metadata?["id"] as? String else { return }
        try? FileManager.default.removeItem(at: audioURL(id))
        try? FileManager.default.removeItem(at: infoURL(id))
        count()
    }
}
