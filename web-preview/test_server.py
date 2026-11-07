"""Local preview checks using in-memory HTTP and an httpx MockTransport.

These tests do not bind a socket or contact the backend or any provider.
"""

from __future__ import annotations

from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import httpx

import server


FAKE_PUBLIC_KEY = "sb_publishable_unit_test_value_1234567890"
FAKE_CONFIG = {"supabaseUrl": server.SUPABASE_URL, "publishableKey": FAKE_PUBLIC_KEY}


class FakeConnection:
    def settimeout(self, _timeout):
        pass


class PreviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.assets = Path(self.temp.name)
        (self.assets / "index.html").write_text("<!doctype html><title>Preview</title>")
        (self.assets / "private.json").write_text('{"secret":"NEVER_RETURN_THIS"}')
        self.calls = []

        def transport(request):
            self.calls.append(request)
            return httpx.Response(200, json={"ok": True})

        self.client = httpx.Client(transport=httpx.MockTransport(transport), trust_env=False)
        self.preview = SimpleNamespace(
            server_port=8767, assets_dir=self.assets,
            public_config=server.public_client_config(FAKE_CONFIG), client=self.client,
        )

    def tearDown(self):
        self.client.close()
        self.temp.cleanup()

    def use_transport(self, callback):
        self.client.close()
        self.client = httpx.Client(transport=httpx.MockTransport(callback), trust_env=False)
        self.preview.client = self.client

    def request(self, path="/", method="GET", headers=(), body=b"", host="127.0.0.1:8767", output=None):
        header_list = list(headers)
        if host is not None:
            header_list.insert(0, ("Host", host))
        if body and not any(name.lower() == "content-length" for name, _ in header_list):
            header_list.append(("Content-Length", str(len(body))))
        wire = f"{method} {path} HTTP/1.1\r\n".encode()
        for name, value in header_list:
            wire += f"{name}: {value}\r\n".encode()
        wire += b"\r\n" + body
        handler = server.PreviewHandler.__new__(server.PreviewHandler)
        handler.connection = FakeConnection()
        handler.client_address = ("127.0.0.1", 12345)
        handler.server = self.preview
        handler.rfile, handler.wfile = BytesIO(wire), output if output is not None else BytesIO()
        handler.close_connection = True
        handler.handle_one_request()
        status_line, _, rest = handler.wfile.getvalue().partition(b"\r\n")
        raw_headers, _, response = rest.partition(b"\r\n\r\n")
        response_headers = {}
        for line in raw_headers.split(b"\r\n"):
            key, _, value = line.partition(b":")
            response_headers[key.decode().lower()] = value.strip().decode()
        return int(status_line.split()[1]), response_headers, response

    def test_static_security_headers_and_head(self):
        status, headers, body = self.request()
        self.assertEqual(status, 200)
        self.assertIn(b"Preview", body)
        self.assertEqual(headers["cache-control"], "no-store")
        self.assertNotIn("access-control-allow-origin", headers)
        self.assertNotIn("set-cookie", headers)
        self.assertIn("script-src 'self'", headers["content-security-policy"])
        self.assertNotIn("unsafe-inline", headers["content-security-policy"])
        self.assertIn("microphone=(self)", headers["permissions-policy"])
        head_status, head_headers, head_body = self.request(method="HEAD")
        self.assertEqual(head_status, 200)
        self.assertEqual(head_body, b"")
        self.assertEqual(head_headers["content-length"], str(len(body)))

    def test_config_has_only_the_public_schema(self):
        status, _, body = self.request("/client-config")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), FAKE_CONFIG)
        self.assertEqual(set(json.loads(body)), {"supabaseUrl", "publishableKey"})
        invalid = {**FAKE_CONFIG, "supabaseSecret": "NEVER_RETURN_THIS"}
        with self.assertRaises(server.InvalidClientConfig) as raised:
            server.public_client_config(invalid)
        self.assertNotIn("NEVER_RETURN_THIS", str(raised.exception))
        with self.assertRaises(server.InvalidClientConfig):
            server.public_client_config({**FAKE_CONFIG, "supabaseUrl": "https://other.invalid"})
        with self.assertRaises(server.InvalidClientConfig):
            server.public_client_config({**FAKE_CONFIG, "publishableKey": "sb_secret_fake"})

    def test_config_loader_rejects_extra_and_duplicate_fields_without_leaks(self):
        path = self.assets / "local.json"
        path.write_text(json.dumps(FAKE_CONFIG))
        self.assertEqual(server.load_client_config(path), FAKE_CONFIG)
        path.write_text(json.dumps({**FAKE_CONFIG, "OPENAI_API_KEY": "NEVER_RETURN_THIS"}))
        with self.assertRaises(server.InvalidClientConfig) as raised:
            server.load_client_config(path)
        self.assertNotIn("NEVER_RETURN_THIS", str(raised.exception))
        path.write_text('{"supabaseUrl":"one","supabaseUrl":"two"}')
        with self.assertRaises(server.InvalidClientConfig):
            server.load_client_config(path)

    def test_private_paths_and_open_proxy_targets_never_reach_backend(self):
        paths = ["/private.json", "/server.py", "/development.auth.local.json", "/.env",
                 "/api/v1/../profiles", "/api/v1/%2e%2e/profiles", "/api/v1/%252e%252e/a",
                 "/api/v1/profiles%2Fexport", "/api/v1/profiles\\other", "//evil.invalid/a",
                 "http://evil.invalid/api/v1/profiles", "/api/v3/profiles", "/api/v1/a#secret"]
        for path in paths:
            with self.subTest(path=path):
                status, _, body = self.request(path)
                self.assertIn(status, (400, 404))
                self.assertNotIn(b"NEVER_RETURN_THIS", body)
        self.assertEqual(self.calls, [])

    def test_host_is_single_exact_loopback_address_and_port(self):
        for host in (None, "evil.invalid:8767", "127.0.0.1", "127.0.0.1:8001",
                     "127.0.0.1:8767.evil.invalid", "127.0.0.2:8767", "localhost:8767."):
            with self.subTest(host=host):
                self.assertEqual(self.request(host=host)[0], 403)
        self.assertEqual(self.request(host="localhost:8767")[0], 200)
        self.assertEqual(self.request(headers=[("Host", "127.0.0.1:8767")])[0], 400)

    def test_mutations_require_matching_origin_and_preflight_has_no_cors(self):
        for origin in (None, "null", "https://evil.invalid", "http://localhost:8767",
                       "http://127.0.0.1:8767.evil.invalid"):
            for method in ("POST", "PATCH"):
                with self.subTest(origin=origin, method=method):
                    headers = [] if origin is None else [("Origin", origin)]
                    status, response_headers, _ = self.request("/api/v1/profiles", method, headers)
                    self.assertEqual(status, 403)
                    self.assertNotIn("access-control-allow-origin", response_headers)
        status, response_headers, _ = self.request("/api/v1/profiles", "OPTIONS")
        self.assertEqual(status, 405)
        self.assertNotIn("access-control-allow-methods", response_headers)
        self.assertEqual(self.request("/", headers=[("Origin", "https://evil.invalid")])[0], 403)
        self.assertEqual(self.calls, [])

    def test_framing_and_body_limits_fail_before_backend(self):
        base = [("Origin", "http://127.0.0.1:8767"), ("Content-Type", "application/json")]
        cases = [base + [("Transfer-Encoding", "chunked")],
                 base + [("Content-Length", "1"), ("Content-Length", "1")],
                 base + [("Content-Length", "-1")],
                 base + [("Content-Length", str(server.MAX_BODY_BYTES + 1))]]
        for index, headers in enumerate(cases):
            with self.subTest(index=index):
                status, _, _ = self.request("/api/v1/profiles", "POST", headers)
                self.assertEqual(status, 413 if index == 3 else 400)
        status, _, body = self.request("/api/v1/profiles", "POST",
                                      base + [("Content-Length", "10")], b"{}")
        self.assertEqual(status, 400)
        self.assertIn(b"PREVIEW_BAD_REQUEST", body)
        self.assertEqual(self.calls, [])

    def test_proxy_preserves_body_and_only_allowlisted_request_headers(self):
        headers = [("Origin", "http://127.0.0.1:8767"),
                   ("Authorization", "Bearer fake.jwt.token"),
                   ("Content-Type", "application/json"), ("Accept", "application/json"),
                   ("Idempotency-Key", "c674eaf1-6195-4a68-9b56-ad1779ea21c0"),
                   ("Cookie", "private-cookie=never"), ("apikey", "never"),
                   ("X-User-Id", "never"), ("X-Forwarded-Host", "evil.invalid")]
        status, _, _ = self.request("/api/v2/profiles?page=1&limit=20", "POST", headers, b'{"a":1}')
        self.assertEqual(status, 200)
        request = self.calls[0]
        self.assertEqual(str(request.url), "http://127.0.0.1:8001/api/v2/profiles?page=1&limit=20")
        self.assertEqual(request.content, b'{"a":1}')
        self.assertEqual(request.headers["authorization"], "Bearer fake.jwt.token")
        for name in ("cookie", "origin", "apikey", "x-user-id", "x-forwarded-host"):
            self.assertNotIn(name, request.headers)

    def test_backend_cookies_and_client_defaults_do_not_cross_requests(self):
        received = []

        def transport(request):
            received.append(request)
            return httpx.Response(200, json={"ok": True}, headers={"Set-Cookie": "session=never"})

        self.use_transport(transport)
        self.client.headers["X-User-Id"] = "never"
        self.client.cookies.set("other", "never", domain="127.0.0.1")
        for _ in range(2):
            status, headers, _ = self.request("/api/v1/profiles")
            self.assertEqual(status, 200)
            self.assertNotIn("set-cookie", headers)
        for request in received:
            self.assertNotIn("cookie", request.headers)
            self.assertNotIn("x-user-id", request.headers)

    def test_invalid_forwarded_headers_are_rejected(self):
        for name, value in [("Authorization", "Basic fake"), ("Authorization", "Bearer fake token"),
                            ("Authorization", "Bearer " + "a" * 8192),
                            ("Idempotency-Key", "not-a-uuid"),
                            ("Content-Type", "text/html"), ("Accept", "x\x01y")]:
            with self.subTest(name=name, value=value[:30]):
                self.assertEqual(self.request("/api/v1/profiles", headers=[(name, value)])[0], 400)
        self.assertEqual(self.calls, [])

    def test_query_bounds_and_injection_are_rejected(self):
        for query in ("limit=101", "page_size=0", "offset=1000001", "page=-1", "a=1&a=2",
                      "limit=10%0d%0aX-Injected%3Ayes", "a=%ZZ", "a=%5csecret", "missing_equals"):
            with self.subTest(query=query):
                self.assertEqual(self.request("/api/v1/profiles?" + query)[0], 400)
        self.assertEqual(self.calls, [])

    def test_network_failure_is_stable_and_does_not_retry_or_leak(self):
        attempts = []

        def transport(request):
            attempts.append(request)
            raise httpx.ConnectError("NEVER_RETURN_THIS", request=request)

        self.use_transport(transport)
        status, _, body = self.request("/api/v1/profiles")
        self.assertEqual(status, 503)
        self.assertEqual(json.loads(body)["error"]["code"], "PREVIEW_BACKEND_UNAVAILABLE")
        self.assertNotIn(b"NEVER_RETURN_THIS", body)
        self.assertEqual(len(attempts), 1)

    def test_redirects_are_not_followed_or_exposed(self):
        attempts = []

        def transport(request):
            attempts.append(request)
            return httpx.Response(302, headers={"Location": "https://evil.invalid/secret"})

        self.use_transport(transport)
        status, headers, body = self.request("/api/v1/profiles")
        self.assertEqual(status, 502)
        self.assertNotIn("location", headers)
        self.assertNotIn(b"evil.invalid", body)
        self.assertEqual(len(attempts), 1)

    def test_response_caps_apply_by_media_type(self):
        for media_type, constant in (("application/json", "MAX_JSON_BYTES"),
                                     ("application/pdf", "MAX_PDF_BYTES"),
                                     ("audio/mpeg", "MAX_AUDIO_BYTES")):
            with self.subTest(media_type=media_type):
                self.use_transport(lambda _request: httpx.Response(
                    200, content=b"123456789", headers={"Content-Type": media_type}))
                with patch.object(server, constant, 8):
                    status, _, body = self.request("/api/v1/profiles")
                self.assertEqual(status, 502)
                self.assertEqual(json.loads(body)["error"]["code"], "PREVIEW_RESPONSE_TOO_LARGE")

    def test_audio_pdf_and_safe_metadata_are_preserved_without_backend_cookies(self):
        for media_type in ("audio/mp4", "application/pdf"):
            with self.subTest(media_type=media_type):
                self.use_transport(lambda _request: httpx.Response(200, content=b"file-data", headers={
                    "Content-Type": media_type, "Content-Disposition": 'attachment; filename="file"',
                    "X-Memy-Duration-Ms": "123", "Retry-After": "2", "Set-Cookie": "never=yes",
                    "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=9999",
                }))
                status, headers, body = self.request("/api/v1/profiles")
                self.assertEqual(status, 200)
                self.assertEqual(body, b"file-data")
                self.assertEqual(headers["content-type"], media_type)
                self.assertEqual(headers["content-length"], str(len(body)))
                self.assertEqual(headers["x-memy-duration-ms"], "123")
                self.assertEqual(headers["retry-after"], "2")
                self.assertEqual(headers["content-disposition"], 'attachment; filename="file"')
                self.assertEqual(headers["cache-control"], "no-store")
                self.assertNotIn("set-cookie", headers)
                self.assertNotIn("access-control-allow-origin", headers)

    def test_delete_is_unsupported(self):
        self.assertEqual(self.request("/api/v1/profiles", "DELETE")[0], 405)
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
