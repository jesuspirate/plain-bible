import UIKit
import WebKit

/// Keeping the screen on while someone prays or listens.
///
/// The page asks for this the web way, `navigator.wakeLock.request('screen')`
/// (prayer.tsx while recording, listen.tsx while a chapter is read aloud).
/// On a phone's Home Screen that works, but inside the App Store app's web
/// view it doesn't hold: the phone still dimmed and auto-locked during a
/// long prayer, and the prayer paused ("The phone locked, so your prayer
/// paused"). So in the app, `navigator.wakeLock` is answered here instead,
/// with the system's own switch, `UIApplication.isIdleTimerDisabled`: on
/// while the page holds at least one lock, back off as soon as it lets go,
/// when the app goes to the background, or when the page reloads.
///
/// On a Mac (the iPad app running there) that switch isn't enough: Apple's
/// forums report the display still turns off and locks, which paused a
/// prayer too. There the app also holds a "keep the display on" activity
/// with the system (`ProcessInfo.beginActivity`, display sleep only),
/// started and ended with the page's lock like the switch. It changes
/// nothing about how the page runs (not the 1.2.8 never-pause setting).
final class AwakeBridge: NSObject, WKScriptMessageHandler {
    static let name = "awake"
    static let script = WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true)

    /// Foundation's NSActivityIdleDisplaySleepDisabled. The iOS SDK leaves
    /// the name out, but on a Mac the app runs on the Mac's Foundation,
    /// which honours it; on an iPhone it isn't used.
    private static let displayOn = ProcessInfo.ActivityOptions(rawValue: 1 << 40)
    private var activity: NSObjectProtocol?

    /// The page's held locks, by number.
    private var held = Set<Int>()

    override init() {
        super.init()
        // In the background the switch means nothing; let go there too, in
        // case the page's own 'hidden' never arrives. Coming back, the page
        // asks again if it still wants the screen on.
        NotificationCenter.default.addObserver(self, selector: #selector(background),
                                               name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    @objc private func background() { reset() }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == BibleViewController.host,
              let body = message.body as? [String: Any], let op = body["op"] as? String else { return }
        let id = (body["id"] as? NSNumber)?.intValue ?? 0
        switch op {
        case "hold": held.insert(id)
        case "free": held.remove(id)
        default: return
        }
        apply()
    }

    /// Everything let go: the page reloaded or its process ended.
    func reset() {
        held.removeAll()
        apply()
    }

    private func apply() {
        let on = !held.isEmpty
        if UIApplication.shared.isIdleTimerDisabled != on {
            UIApplication.shared.isIdleTimerDisabled = on
        }
        guard ProcessInfo.processInfo.isiOSAppOnMac else { return }
        if on, activity == nil {
            activity = ProcessInfo.processInfo.beginActivity(options: Self.displayOn, reason: "Praying or listening")
        } else if !on, let activity {
            ProcessInfo.processInfo.endActivity(activity)
            self.activity = nil
        }
    }

    // Like the web's own: a lock ends when the page is hidden (the app goes
    // to the background or the phone is locked by hand); the page asks again
    // when it comes back. `released`, `type`, `onrelease` and the 'release'
    // event behave as in the browser.
    private static let js = """
    (() => {
      const post = (op, id) => { try { webkit.messageHandlers.awake.postMessage({ op, id }) } catch (e) {} };
      let next = 1;
      const live = new Set();
      class Sentinel extends EventTarget {
        constructor() { super(); this._id = next++; this._released = false; this.onrelease = null; }
        get released() { return this._released }
        get type() { return 'screen' }
        release() {
          if (!this._released) {
            this._released = true;
            live.delete(this);
            post('free', this._id);
            const e = new Event('release');
            try { if (typeof this.onrelease === 'function') this.onrelease(e) } catch (x) {}
            this.dispatchEvent(e);
          }
          return Promise.resolve();
        }
      }
      const wakeLock = {
        request(type) {
          if (type !== undefined && type !== 'screen') return Promise.reject(new TypeError('Only screen'));
          if (document.visibilityState !== 'visible') return Promise.reject(new DOMException('Page is hidden', 'NotAllowedError'));
          const s = new Sentinel();
          live.add(s);
          post('hold', s._id);
          return Promise.resolve(s);
        }
      };
      try { Object.defineProperty(navigator, 'wakeLock', { get: () => wakeLock, configurable: true }) } catch (e) {}
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') for (const s of [...live]) s.release();
      });
      addEventListener('pagehide', () => { for (const s of [...live]) s.release() });
    })();
    """
}
