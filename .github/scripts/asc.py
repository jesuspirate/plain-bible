"""Talks to the App Store Connect API with the key put in place by
ios-release.yml (AuthKey_<ASC_KEY_ID>.p8 in $RUNNER_TEMP/asc)."""
import base64, json, os, subprocess, time, urllib.request

_token = None


def _b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=")


def token():
    global _token
    if _token:
        return _token
    kid, iss = os.environ["ASC_KEY_ID"], os.environ["ASC_ISSUER_ID"]
    key = os.path.join(os.environ["RUNNER_TEMP"], "asc", f"AuthKey_{kid}.p8")
    now = int(time.time())
    head = _b64(json.dumps({"alg": "ES256", "kid": kid, "typ": "JWT"}).encode())
    body = _b64(json.dumps({"iss": iss, "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"}).encode())
    der = subprocess.run(["openssl", "dgst", "-sha256", "-sign", key], input=head + b"." + body,
                         capture_output=True, check=True).stdout

    # DER ECDSA signature -> the raw 64 bytes a JWT wants.
    def ints(d):
        i, out = 2 + (d[1] & 0x7f if d[1] & 0x80 else 0), []
        for _ in range(2):
            n = d[i + 1]; v = d[i + 2:i + 2 + n]; i += 2 + n
            out.append(v.lstrip(b"\0").rjust(32, b"\0"))
        return b"".join(out)

    _token = (head + b"." + body + b"." + _b64(ints(der))).decode()
    return _token


def call(method, path):
    url = path if path.startswith("http") else "https://api.appstoreconnect.apple.com" + path
    req = urllib.request.Request(url, method=method, headers={"Authorization": "Bearer " + token()})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b"{}")


def every(path):
    """All items of a list, following Apple's next-page links."""
    while path:
        page = call("GET", path)
        yield from page.get("data", [])
        path = page.get("links", {}).get("next")
