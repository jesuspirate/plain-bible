import AuthenticationServices
import CryptoKit
import UIKit
import WebKit

/// Passkeys where the web view has none.
///
/// On an iPhone or iPad the web view runs the site's passkey code itself
/// (the app and the site vouch for each other, `webcredentials:` in the
/// entitlements). On a Mac, where this same app runs as "Designed for iPad",
/// the web view leaves passkeys out: Apple keeps them for web browsers there.
/// The page then finds no `PublicKeyCredential` and only offers an email code.
///
/// So where the page has no passkeys of its own, `script` gives it the two
/// standard calls (`navigator.credentials.create` and `.get`), and they ask
/// the system's own passkey sheet through this bridge. The site needs no
/// change, and where the web view already has passkeys nothing here runs.
final class PasskeyBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let name = "passkey"

    static let script = WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true)

    private var asking: Ceremony?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        // Only the site's own page may ask, and only for the site's passkeys.
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == BibleViewController.host,
              let ask = message.body as? [String: Any], let kind = ask["kind"] as? String else {
            return replyHandler(["error": "NotAllowedError"], nil)
        }
        if kind == "cancel" {
            asking?.cancel()
            return replyHandler([:], nil)
        }
        guard kind == "create" || kind == "get",
              ask["rpId"] as? String == BibleViewController.host,
              let challenge = Self.data(ask["challenge"]) else {
            return replyHandler(["error": "NotAllowedError"], nil)
        }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: BibleViewController.host)
        let verify = ASAuthorizationPublicKeyCredentialUserVerificationPreference(rawValue: ask["uv"] as? String ?? "preferred")
        // The secret that unlocks synced prayers and circles (the "prf"
        // extension), asked for in the same sheet. Older systems can't; the
        // page then falls back as it does in any browser without it.
        let salt = Self.data(ask["prf"])
        let ids = (ask["credentials"] as? [String] ?? []).compactMap { Self.data($0) }
            .map { ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: $0) }

        let request: ASAuthorizationRequest
        if kind == "create" {
            guard let userID = Self.data(ask["userId"]), let name = ask["userName"] as? String else {
                return replyHandler(["error": "NotAllowedError"], nil)
            }
            let r = provider.createCredentialRegistrationRequest(challenge: challenge, name: name, userID: userID)
            r.userVerificationPreference = verify
            if #available(iOS 17.4, *) { r.excludedCredentials = ids }
            if #available(iOS 18.0, *), let salt { r.prf = .inputValues(.init(saltInput1: salt)) }
            request = r
        } else {
            let r = provider.createCredentialAssertionRequest(challenge: challenge)
            r.userVerificationPreference = verify
            r.allowedCredentials = ids
            if #available(iOS 18.0, *), let salt { r.prf = .inputValues(.init(saltInput1: salt)) }
            request = r
        }

        // One sheet at a time: a new request ends the one before it.
        asking?.cancel()
        let ceremony = Ceremony(request: request, window: message.webView?.window) { [weak self] ceremony, answer in
            if self?.asking === ceremony { self?.asking = nil }
            replyHandler(answer, nil)
        }
        asking = ceremony
        ceremony.start()
    }

    // MARK: base64url, as the page sends and reads it

    static func data(_ value: Any?) -> Data? {
        guard var s = value as? String else { return nil }
        s = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while s.count % 4 != 0 { s += "=" }
        return Data(base64Encoded: s)
    }

    static func text(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    /// One passkey sheet and its one answer.
    private final class Ceremony: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
        private let controller: ASAuthorizationController
        private weak var window: UIWindow?
        private var done: ((Ceremony, [String: Any]) -> Void)?

        init(request: ASAuthorizationRequest, window: UIWindow?, done: @escaping (Ceremony, [String: Any]) -> Void) {
            controller = ASAuthorizationController(authorizationRequests: [request])
            self.window = window
            self.done = done
            super.init()
            controller.delegate = self
            controller.presentationContextProvider = self
        }

        func start() { controller.performRequests() }

        func cancel() {
            controller.cancel()
            finish(["error": "AbortError"])
        }

        /// The page's promise is answered once, whatever comes after.
        private func finish(_ answer: [String: Any]) {
            guard let done else { return }
            self.done = nil
            done(self, answer)
        }

        func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
            if let window { return window }
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
        }

        func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
            switch authorization.credential {
            case let made as ASAuthorizationPlatformPublicKeyCredentialRegistration:
                var answer: [String: Any] = [
                    "id": PasskeyBridge.text(made.credentialID),
                    "clientDataJSON": PasskeyBridge.text(made.rawClientDataJSON),
                    "attestationObject": PasskeyBridge.text(made.rawAttestationObject ?? Data()),
                ]
                if #available(iOS 16.6, *) { answer["attachment"] = Self.word(made.attachment) }
                if #available(iOS 18.0, *), let prf = made.prf {
                    answer["prfEnabled"] = prf.isSupported
                    if let first = prf.first { answer["prf"] = PasskeyBridge.text(first.withUnsafeBytes { Data($0) }) }
                }
                finish(answer)
            case let used as ASAuthorizationPlatformPublicKeyCredentialAssertion:
                var answer: [String: Any] = [
                    "id": PasskeyBridge.text(used.credentialID),
                    "clientDataJSON": PasskeyBridge.text(used.rawClientDataJSON),
                    "authenticatorData": PasskeyBridge.text(used.rawAuthenticatorData),
                    "signature": PasskeyBridge.text(used.signature),
                    "userHandle": PasskeyBridge.text(used.userID),
                ]
                if #available(iOS 16.6, *) { answer["attachment"] = Self.word(used.attachment) }
                if #available(iOS 18.0, *), let prf = used.prf {
                    answer["prf"] = PasskeyBridge.text(prf.first.withUnsafeBytes { Data($0) })
                }
                finish(answer)
            default:
                finish(["error": "NotAllowedError"])
            }
        }

        func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
            let e = error as NSError
            // 1006: this account already has a passkey here (iOS 18 names it
            // matchedExcludedCredential). Everything else reads as "canceled",
            // which is also what a browser tells a page.
            let excluded = e.domain == ASAuthorizationErrorDomain && e.code == 1006
            finish(["error": excluded ? "InvalidStateError" : "NotAllowedError", "message": e.localizedDescription])
        }

        @available(iOS 16.6, *)
        private static func word(_ attachment: ASAuthorizationPublicKeyCredentialAttachment) -> String {
            attachment == .crossPlatform ? "cross-platform" : "platform"
        }
    }

    // MARK: The page's side

    /// Runs before the page's own code. Where the web view has passkeys it
    /// stops at the first line.
    private static let js = #"""
    (() => {
      const native = window.webkit && webkit.messageHandlers && webkit.messageHandlers.passkey
      if (window.PublicKeyCredential || !native) return

      const bytes = b => b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
      const enc = b => {
        let s = ''
        for (const x of bytes(b)) s += String.fromCharCode(x)
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      }
      const dec = s => {
        const raw = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'))
        const out = new Uint8Array(raw.length)
        for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
        return out.buffer
      }

      class Passkey {
        static isUserVerifyingPlatformAuthenticatorAvailable() { return Promise.resolve(true) }
        static isConditionalMediationAvailable() { return Promise.resolve(false) }
      }
      class Made {}
      class Used {}
      Object.assign(window, { PublicKeyCredential: Passkey, AuthenticatorAttestationResponse: Made, AuthenticatorAssertionResponse: Used })

      const stopped = signal => signal.reason || new DOMException('The request was stopped.', 'AbortError')

      async function ask(kind, options) {
        const o = options && options.publicKey
        if (!o) throw new DOMException('Only passkeys are supported.', 'NotSupportedError')
        const signal = options.signal
        if (signal && signal.aborted) throw stopped(signal)
        const prf = o.extensions && o.extensions.prf && o.extensions.prf.eval && o.extensions.prf.eval.first
        const list = (kind === 'create' ? o.excludeCredentials : o.allowCredentials) || []
        const sel = o.authenticatorSelection || {}
        const sent = native.postMessage({
          kind,
          rpId: (kind === 'create' ? o.rp && o.rp.id : o.rpId) || location.hostname,
          challenge: enc(o.challenge),
          uv: (kind === 'create' ? sel.userVerification : o.userVerification) || 'preferred',
          prf: prf ? enc(prf) : null,
          credentials: list.map(c => enc(c.id)),
          userId: o.user ? enc(o.user.id) : null,
          userName: o.user ? o.user.name : null,
        })
        // The page gave up waiting (a sheet that never answered): close it.
        let stop
        const r = await (!signal ? sent : Promise.race([sent, new Promise((_, no) => {
          stop = () => { native.postMessage({ kind: 'cancel' }).catch(() => {}); no(stopped(signal)) }
          signal.addEventListener('abort', stop, { once: true })
        })]).finally(() => signal.removeEventListener('abort', stop)))
        if (!r || r.error) throw new DOMException((r && r.message) || 'The request was canceled.', (r && r.error) || 'NotAllowedError')

        const ext = {}
        if (prf && (r.prf || r.prfEnabled !== undefined)) {
          ext.prf = {}
          if (kind === 'create') ext.prf.enabled = !!(r.prfEnabled || r.prf)
          if (r.prf) ext.prf.results = { first: dec(r.prf) }
        }
        const response = Object.create((kind === 'create' ? Made : Used).prototype)
        response.clientDataJSON = dec(r.clientDataJSON)
        if (kind === 'create') response.attestationObject = dec(r.attestationObject)
        else {
          response.authenticatorData = dec(r.authenticatorData)
          response.signature = dec(r.signature)
          response.userHandle = r.userHandle ? dec(r.userHandle) : null
        }
        const cred = Object.create(Passkey.prototype)
        cred.id = r.id
        cred.rawId = dec(r.id)
        cred.type = 'public-key'
        cred.authenticatorAttachment = r.attachment || 'platform'
        cred.response = response
        cred.getClientExtensionResults = () => ext
        return cred
      }

      const credentials = navigator.credentials || {}
      credentials.create = options => ask('create', options)
      credentials.get = options => ask('get', options)
      if (!navigator.credentials) Object.defineProperty(navigator, 'credentials', { value: credentials, configurable: true })
    })()
    """#
}
