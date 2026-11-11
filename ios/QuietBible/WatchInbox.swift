import Foundation
import WatchConnectivity
import WebKit

/// Prayers that come from the Apple Watch app.
///
/// The watch sends each prayer as a file. It can arrive while the web app
/// isn't running, so it waits here (`<id>.m4a` and `<id>.json` in Application
/// Support/WatchPrayers) until the web app asks for it, keeps it in
/// "Your prayers", and says it's done. Only then is this copy deleted.
final class WatchInbox: NSObject, WCSessionDelegate {
    static let shared = WatchInbox()
    /// Posted when a prayer arrives, so an open web app can take it at once.
    static let arrived = Notification.Name("QuietBibleWatchPrayerArrived")

    private let folder: URL = {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appendingPathComponent("WatchPrayers", isDirectory: true)
    }()

    func start() {
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// Ids are made on the watch: letters and digits only, so they can't point elsewhere.
    private static func safe(_ id: String) -> Bool {
        !id.isEmpty && id.count <= 40 && id.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) }
    }

    private func audioURL(_ id: String) -> URL { folder.appendingPathComponent(id + ".m4a") }
    private func infoURL(_ id: String) -> URL { folder.appendingPathComponent(id + ".json") }

    /// The oldest waiting prayer, ready for the web app: id, at, ms, type, and the audio in base64.
    func next() -> [String: Any]? {
        let files = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        let infos = files.filter { $0.pathExtension == "json" }.compactMap { url -> [String: Any]? in
            guard let data = try? Data(contentsOf: url),
                  let info = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
            return info
        }
        for info in infos.sorted(by: { ($0["at"] as? Int ?? 0) < ($1["at"] as? Int ?? 0) }) {
            guard let id = info["id"] as? String, Self.safe(id),
                  let audio = try? Data(contentsOf: audioURL(id)) else { continue }
            var out = info
            out["audio"] = audio.base64EncodedString()
            return out
        }
        return nil
    }

    /// The web app has kept it.
    func done(_ id: String) {
        guard Self.safe(id) else { return }
        try? FileManager.default.removeItem(at: audioURL(id))
        try? FileManager.default.removeItem(at: infoURL(id))
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, didReceive file: WCSessionFile) {
        guard let meta = file.metadata, let id = meta["id"] as? String, Self.safe(id),
              let at = meta["at"] as? Int, let ms = meta["ms"] as? Int else { return }
        // The file is only ours until this returns: move it now.
        let audio = audioURL(id)
        try? FileManager.default.removeItem(at: audio)
        do { try FileManager.default.moveItem(at: file.fileURL, to: audio) } catch { return }
        let info: [String: Any] = ["id": id, "at": at, "ms": ms, "type": meta["type"] as? String ?? "audio/mp4"]
        guard let data = try? JSONSerialization.data(withJSONObject: info) else { return }
        try? data.write(to: infoURL(id), options: .atomic)
        DispatchQueue.main.async { NotificationCenter.default.post(name: Self.arrived, object: nil) }
    }

    func session(_ session: WCSession, activationDidCompleteWith state: WCSessionActivationState, error: Error?) {}
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {
        // A new watch was paired: listen to it.
        session.activate()
    }
}

/// `window.webkit.messageHandlers.watch` in the web app:
/// `{op: "next"}` answers the oldest waiting prayer (or null),
/// `{op: "done", id}` deletes the copy here once the web app has kept it.
final class WatchBridge: NSObject, WKScriptMessageHandlerWithReply {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == BibleViewController.host,
              let body = message.body as? [String: Any], let op = body["op"] as? String else {
            return replyHandler(nil, "no")
        }
        switch op {
        case "next":
            DispatchQueue.global(qos: .userInitiated).async {
                let p = WatchInbox.shared.next()
                DispatchQueue.main.async { replyHandler(p, nil) }
            }
        case "done":
            if let id = body["id"] as? String { WatchInbox.shared.done(id) }
            replyHandler(true, nil)
        default:
            replyHandler(nil, "unknown")
        }
    }
}
