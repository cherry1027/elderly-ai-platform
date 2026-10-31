#!/usr/bin/env python3
"""A loopback-only static preview and bounded proxy to the local API.

No provider secret is needed or read here.  The only configuration read is the
mobile development client's publishable Supabase configuration.
"""

from __future__ import annotations

import argparse
from collections.abc import Mapping
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import socket
import sys
import time
from urllib.parse import parse_qsl, urlsplit
import uuid

import httpx


HERE = Path(__file__).resolve().parent
CLIENT_CONFIG_PATH = HERE.parent / "apps" / "mobile" / "development.auth.local.json"
SUPABASE_URL = "https://edbkuunyeyxnyenmmqud.supabase.co"
BACKEND_URL = "http://127.0.0.1:8001"
MAX_BODY_BYTES = 25_100_000
MAX_JSON_BYTES = 2_000_000
MAX_PDF_BYTES = 2_000_000
MAX_AUDIO_BYTES = 10_000_000
BODY_TIMEOUT_SECONDS = 30.0
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/api.js": ("api.js", "text/javascript; charset=utf-8"),
    "/workspace.js": ("workspace.js", "text/javascript; charset=utf-8"),
}
API_PATH = re.compile(r"/api/v[12]/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*/?\Z")
PUBLIC_KEY = re.compile(r"sb_publishable_[A-Za-z0-9_-]{16,200}\Z")
BEARER = re.compile(r"Bearer [A-Za-z0-9._~+/-]+={0,2}\Z")
QUERY_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_]{0,63}\Z")
UUID_VALUE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\Z"
)
JSON_TYPE = re.compile(r"application/json(?:\s*;\s*charset=utf-8)?\Z", re.I)
MULTIPART_TYPE = re.compile(
    r'multipart/form-data\s*;\s*boundary=(?:[A-Za-z0-9\x27()+_,./:=?-]{1,70}|'
    r'"[A-Za-z0-9\x27()+_,./:=? -]{1,70}")\Z',
    re.I,
)
AUDIO_TYPE = re.compile(
    r"audio/(?:aac|m4a|mp4|mpeg|ogg|wav|x-wav|webm)"
    r"(?:\s*;\s*codecs=[A-Za-z0-9.,_-]+)?\Z",
    re.I,
)
SINGLE_HEADERS = (
    "Host", "Origin", "Content-Length", "Content-Type", "Authorization",
    "Idempotency-Key", "Accept", "Expect",
)
CSP = "; ".join((
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    f"connect-src 'self' {SUPABASE_URL}",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
))


class InvalidClientConfig(ValueError):
    """The client configuration does not have the explicitly public schema."""


def public_client_config(value: object) -> dict[str, str]:
    """Validate and reconstruct the exact public response, never copying fields."""
    if not isinstance(value, Mapping) or set(value) != {"supabaseUrl", "publishableKey"}:
        raise InvalidClientConfig("Client configuration is unavailable.")
    url, key = value.get("supabaseUrl"), value.get("publishableKey")
    if url != SUPABASE_URL or not isinstance(key, str) or not PUBLIC_KEY.fullmatch(key):
        raise InvalidClientConfig("Client configuration is unavailable.")
    return {"supabaseUrl": SUPABASE_URL, "publishableKey": key}


def _unique_json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            raise InvalidClientConfig("Client configuration is unavailable.")
        value[key] = item
    return value


def load_client_config(path: Path = CLIENT_CONFIG_PATH) -> dict[str, str]:
    try:
        with path.open("rb") as source:
            data = source.read(16_385)
        if len(data) > 16_384:
            raise InvalidClientConfig("Client configuration is unavailable.")
        return public_client_config(json.loads(data, object_pairs_hook=_unique_json_object))
    except (OSError, UnicodeError, ValueError, TypeError):
        raise InvalidClientConfig("Client configuration is unavailable.") from None


def safe_header(value: str, max_length: int = 512) -> bool:
    return 0 < len(value) <= max_length and all(32 <= ord(char) <= 126 for char in value)


def valid_query(query: str) -> bool:
    if len(query) > 2048 or re.search(r"%(?![0-9A-Fa-f]{2})", query):
        return False
    try:
        pairs = parse_qsl(query, keep_blank_values=True, strict_parsing=True,
                          max_num_fields=24, errors="strict")
    except (UnicodeError, ValueError):
        return False
    seen: set[str] = set()
    for key, value in pairs:
        if not QUERY_NAME.fullmatch(key) or key in seen or len(value) > 512:
            return False
        seen.add(key)
        if any(ord(char) < 32 or ord(char) == 127 or char == "\\" for char in value):
            return False
        bounds = {"limit": (1, 100), "page_size": (1, 100),
                  "page": (1, 10_000), "offset": (0, 1_000_000)}
        if key in bounds:
            low, high = bounds[key]
            if not re.fullmatch(r"[0-9]{1,7}", value) or not low <= int(value) <= high:
                return False
    return True


class PreviewHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "MemyLocalPreview"
    sys_version = ""

    def log_message(self, *_args: object) -> None:
        # Request URLs and auth headers never belong in preview logs.
        pass

    def handle_expect_100(self) -> bool:
        self._error(417, "PREVIEW_BAD_REQUEST", "This request is not supported.")
        return False

    def send_error(self, code: int, message: str | None = None,
                   explain: str | None = None) -> None:
        self._error(code, "PREVIEW_BAD_REQUEST", "This request is not supported.")

    def _write(self, status: int, body: bytes, content_type: str,
               extra_headers: dict[str, str] | None = None) -> None:
        self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Pragma", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Permissions-Policy", (
            "microphone=(self), camera=(), geolocation=(), payment=(), usb=(), "
            "display-capture=()"
        ))
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Connection", "close")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if getattr(self, "command", None) != "HEAD":
            self.wfile.write(body)

    def _json(self, status: int, value: object) -> None:
        self._write(status, json.dumps(value, separators=(",", ":")).encode(),
                    "application/json; charset=utf-8")

    def _error(self, status: int, code: str, message: str) -> None:
        self._json(status, {"error": {"code": code, "message": message}})

    def _validate_envelope(self) -> bool:
        if any(len(self.headers.get_all(name, [])) > 1 for name in SINGLE_HEADERS):
            self._error(400, "PREVIEW_BAD_REQUEST", "This request is not supported.")
            return False
        host = self.headers.get("Host", "")
        allowed = {f"127.0.0.1:{self.server.server_port}",
                   f"localhost:{self.server.server_port}"}
        if host not in allowed:
            self._error(403, "PREVIEW_ORIGIN_REJECTED", "Use the local preview address.")
            return False
        origin = self.headers.get("Origin")
        if (origin is not None and origin != f"http://{host}") or (
            self.command in {"POST", "PATCH"} and origin != f"http://{host}"
        ):
            self._error(403, "PREVIEW_ORIGIN_REJECTED", "Use the local preview address.")
            return False
        if self.headers.get_all("Transfer-Encoding") or self.headers.get("Expect"):
            self._error(400, "PREVIEW_BAD_REQUEST", "This request is not supported.")
            return False
        length = self.headers.get("Content-Length", "0")
        if not re.fullmatch(r"[0-9]{1,9}", length):
            self._error(400, "PREVIEW_BAD_REQUEST", "The request length is invalid.")
            return False
        self.body_length = int(length)
        if self.body_length > MAX_BODY_BYTES:
            self._error(413, "PREVIEW_REQUEST_TOO_LARGE", "This upload is too large.")
            return False
        if self.command in {"GET", "HEAD"} and self.body_length:
            self._error(400, "PREVIEW_BAD_REQUEST", "This request is not supported.")
            return False
        return True

    def _target(self) -> tuple[str, str] | None:
        target = self.path
        if (len(target) > 4096 or not target.startswith("/") or target.startswith("//")
                or any(ord(char) < 33 or ord(char) > 126 for char in target)
                or "\\" in target or "#" in target):
            return None
        try:
            parsed = urlsplit(target)
        except ValueError:
            return None
        # Endpoints and IDs have no need for escaped path segments or dots.
        if parsed.scheme or parsed.netloc or "%" in parsed.path or "." in parsed.path:
            if parsed.path not in ASSETS or "%" in parsed.path or parsed.scheme or parsed.netloc:
                return None
        if not valid_query(parsed.query):
            return None
        return parsed.path, parsed.query

    def _request_headers(self) -> dict[str, str] | None:
        headers: dict[str, str] = {}
        authorization = self.headers.get("Authorization")
        if authorization is not None:
            if len(authorization) > 8192 or not BEARER.fullmatch(authorization):
                return None
            headers["Authorization"] = authorization
        content_type = self.headers.get("Content-Type")
        if content_type is not None:
            if not safe_header(content_type, 256) or not (
                JSON_TYPE.fullmatch(content_type) or MULTIPART_TYPE.fullmatch(content_type)
                or AUDIO_TYPE.fullmatch(content_type)
            ):
                return None
            headers["Content-Type"] = content_type
        elif self.body_length:
            return None
        idempotency = self.headers.get("Idempotency-Key")
        if idempotency is not None:
            if not UUID_VALUE.fullmatch(idempotency):
                return None
            try:
                uuid.UUID(idempotency)
            except ValueError:
                return None
            headers["Idempotency-Key"] = idempotency
        accept = self.headers.get("Accept")
        if accept is not None:
            if not safe_header(accept, 256):
                return None
            headers["Accept"] = accept
        return headers

    def _body(self) -> bytes | None:
        deadline = time.monotonic() + BODY_TIMEOUT_SECONDS
        chunks: list[bytes] = []
        remaining = self.body_length
        while remaining:
            timeout = deadline - time.monotonic()
            if timeout <= 0:
                self._error(408, "PREVIEW_REQUEST_TIMEOUT", "The upload took too long.")
                return None
            self.connection.settimeout(min(10.0, timeout))
            try:
                chunk = self.rfile.read(min(65_536, remaining))
            except (OSError, TimeoutError):
                self._error(408, "PREVIEW_REQUEST_TIMEOUT", "The upload took too long.")
                return None
            if not chunk:
                self._error(400, "PREVIEW_BAD_REQUEST", "The upload was incomplete.")
                return None
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _proxy(self, path: str, query: str) -> None:
        headers = self._request_headers()
        if headers is None:
            self._error(400, "PREVIEW_BAD_REQUEST", "The request headers are invalid.")
            return
        body = self._body()
        if body is None:
            return
        url = BACKEND_URL + path + ("?" + query if query else "")
        try:
            # An explicit Request avoids merging shared-client cookies, default
            # auth, or other mutable per-user state into another user's call.
            request = httpx.Request(self.command, url, headers=headers, content=body)
            with closing(self.server.client.send(
                request, stream=True, follow_redirects=False, auth=None
            )) as upstream:
                if 300 <= upstream.status_code < 400:
                    self._error(502, "PREVIEW_BACKEND_RESPONSE_INVALID",
                                "The local service returned an unsupported response.")
                    return
                content_type = upstream.headers.get("Content-Type", "application/json")
                if not safe_header(content_type, 256):
                    raise ValueError("Invalid response content type")
                media_type = content_type.split(";", 1)[0].strip().lower()
                if media_type == "application/pdf":
                    limit = MAX_PDF_BYTES
                elif media_type.startswith("audio/"):
                    limit = MAX_AUDIO_BYTES
                elif media_type == "application/json" or media_type.endswith("+json"):
                    limit = MAX_JSON_BYTES
                elif upstream.status_code == 204:
                    limit = 0
                else:
                    self._error(502, "PREVIEW_BACKEND_RESPONSE_INVALID",
                                "The local service returned an unsupported response.")
                    return
                chunks: list[bytes] = []
                size = 0
                for chunk in upstream.iter_bytes(chunk_size=65_536):
                    size += len(chunk)
                    if size > limit:
                        self._error(502, "PREVIEW_RESPONSE_TOO_LARGE",
                                    "The local service response is too large.")
                        return
                    chunks.append(chunk)
                response_headers: dict[str, str] = {}
                for name, value in upstream.headers.items():
                    lower = name.lower()
                    if lower in {"content-disposition", "retry-after"} or (
                        re.fullmatch(r"x-memy-[a-z0-9-]{1,64}", lower)
                    ):
                        if safe_header(value, 256):
                            response_headers[name] = value
                self._write(upstream.status_code, b"".join(chunks), content_type,
                            response_headers)
        except (httpx.HTTPError, OSError, ValueError):
            self._error(503, "PREVIEW_BACKEND_UNAVAILABLE",
                        "The local service is unavailable. Please try again later.")

    def _dispatch(self) -> None:
        if not self._validate_envelope():
            return
        target = self._target()
        if target is None:
            self._error(400, "PREVIEW_BAD_REQUEST", "This request path is not supported.")
            return
        path, query = target
        if self.command not in {"GET", "HEAD", "POST", "PATCH"}:
            self._error(405, "PREVIEW_METHOD_NOT_ALLOWED", "This method is not supported.")
            return
        if API_PATH.fullmatch(path):
            if self.command == "HEAD":
                self._error(405, "PREVIEW_METHOD_NOT_ALLOWED", "This method is not supported.")
            else:
                self._proxy(path, query)
            return
        if self.command not in {"GET", "HEAD"}:
            self._error(405, "PREVIEW_METHOD_NOT_ALLOWED", "This method is not supported.")
            return
        if query:
            self._error(400, "PREVIEW_BAD_REQUEST", "This request path is not supported.")
            return
        if path == "/client-config":
            self._json(200, self.server.public_config)
            return
        asset = ASSETS.get(path)
        if asset is None:
            self._error(404, "PREVIEW_NOT_FOUND", "This preview resource was not found.")
            return
        filename, content_type = asset
        asset_path = self.server.assets_dir / filename
        try:
            if asset_path.resolve().parent != self.server.assets_dir.resolve():
                raise OSError("Asset outside preview")
            data = asset_path.read_bytes()
        except OSError:
            self._error(404, "PREVIEW_NOT_FOUND", "This preview resource was not found.")
            return
        self._write(200, data, content_type)

    def do_GET(self) -> None:
        self._dispatch()

    do_HEAD = do_GET
    do_POST = do_GET
    do_PATCH = do_GET
    do_DELETE = do_GET
    do_OPTIONS = do_GET
    do_PUT = do_GET


class PreviewServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, port: int, public_config: Mapping[str, str], *,
                 assets_dir: Path = HERE, client: httpx.Client | None = None):
        self.public_config = public_client_config(public_config)
        self.assets_dir = assets_dir
        self.client = client or httpx.Client(
            timeout=httpx.Timeout(130.0, connect=3.0, read=130.0, write=30.0, pool=3.0),
            limits=httpx.Limits(max_connections=8, max_keepalive_connections=8),
            follow_redirects=False,
            trust_env=False,
        )
        try:
            super().__init__(("127.0.0.1", port), PreviewHandler)
        except BaseException:
            self.client.close()
            raise

    def get_request(self) -> tuple[socket.socket, object]:
        connection, address = super().get_request()
        connection.settimeout(10.0)
        return connection, address

    def handle_error(self, request: object, client_address: object) -> None:
        # Suppress tracebacks that could include authenticated request details.
        pass

    def server_close(self) -> None:
        super().server_close()
        self.client.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the local Memy web preview.")
    parser.add_argument("--port", type=int, default=8767)
    parser.add_argument("--client-config", type=Path, default=CLIENT_CONFIG_PATH,
                        help="Path to the mobile client's public Supabase JSON configuration.")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("port must be between 1024 and 65535")
    try:
        config = load_client_config(args.client_config)
        server = PreviewServer(args.port, config)
    except InvalidClientConfig:
        print("Preview client configuration is unavailable.", file=sys.stderr)
        return 1
    except OSError:
        print("The local preview could not start on the requested port.", file=sys.stderr)
        return 1
    print(f"Memy local preview: http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
