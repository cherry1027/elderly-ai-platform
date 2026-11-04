"""Single-process staging launcher with durable state and no implicit AI spend.

Render terminates TLS and redirects HTTP at its managed edge. This launcher
never trusts client-supplied forwarding headers. Other hosts must use direct TLS
with private certificate/key files or implement a separately reviewed ingress.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import threading
from datetime import datetime, timezone
from urllib.parse import urlsplit

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from scripts.staging_state import (  # noqa: E402
    StateError, create_backup, private_directory, private_file, verify_history,
)

DEVELOPMENT_SUPABASE = "https://edbkuunyeyxnyenmmqud.supabase.co"


def https_origin(value: str) -> str:
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.path not in ("", "/")
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or "*" in value or parsed.hostname in {"localhost", "testserver"}
            or parsed.port not in (None, 443)):
        raise StateError("EXACT_PUBLIC_HTTPS_ORIGIN_REQUIRED")
    try:
        ipaddress.ip_address(parsed.hostname)
    except ValueError:
        pass
    else:
        raise StateError("PUBLIC_DNS_ORIGIN_REQUIRED")
    if (len(parsed.hostname) > 253 or "." not in parsed.hostname
            or not all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", part)
                       for part in parsed.hostname.split("."))):
        raise StateError("PUBLIC_DNS_ORIGIN_REQUIRED")
    return f"https://{parsed.hostname}"


def flag(name: str) -> bool:
    value = os.environ.get(name, "false")
    if value not in {"true", "false"}:
        raise StateError("INVALID_STAGING_FLAG")
    return value == "true"


def persistent_path(value: Path | None, state: Path) -> Path:
    if value is None or not value.is_absolute() or ".." in value.parts:
        raise StateError("PERSISTENT_STATE_REQUIRED")
    try:
        value.relative_to(state)
    except ValueError:
        raise StateError("PERSISTENT_STATE_REQUIRED") from None
    # Files may be absent only when provisioning the explicitly AI-off shell.
    private_directory(value.parent)
    if value.exists() or value.is_symlink():
        private_file(value)
    return value


def staging_configuration():
    from app.core.config import Settings

    state = private_directory(Path(os.environ.get("STAGING_STATE_DIR", "/var/data/memy")))
    origin = https_origin(os.environ.get("STAGING_ORIGIN", ""))
    tls_mode = os.environ.get("STAGING_TLS_MODE", "direct")
    if tls_mode not in {"render-edge", "direct"}:
        raise StateError("REVIEWED_TLS_REQUIRED")
    if tls_mode == "render-edge":
        if os.environ.get("RENDER") != "true":
            raise StateError("RENDER_EDGE_REQUIRED")
        external = os.environ.get("RENDER_EXTERNAL_HOSTNAME", "")
        if external and https_origin("https://" + external) != origin:
            raise StateError("STAGING_HOST_MISMATCH")
    origins = json.loads(os.environ.get("CORS_ORIGINS", "[]"))
    if not isinstance(origins, list) or any(not isinstance(item, str) for item in origins):
        raise StateError("EXACT_HTTPS_CORS_REQUIRED")
    origins = [https_origin(item) for item in origins]
    settings = Settings(_env_file=None)
    if not settings.supabase_configured or str(settings.supabase_url).rstrip("/") != DEVELOPMENT_SUPABASE:
        raise StateError("DEVELOPMENT_PROJECT_REQUIRED")
    ledger = persistent_path(state / "ledger.sqlite3", state)
    usage_log = persistent_path(state / "usage.jsonl", state)
    manifest = persistent_path(state / "history.json", state)
    bootstrap = flag("STAGING_BOOTSTRAP_AI_OFF")
    requested = flag("STAGING_ENABLE_REAL_AI")
    if bootstrap and requested:
        raise StateError("BOOTSTRAP_CANNOT_ENABLE_AI")
    if not bootstrap:
        verify_history(ledger, manifest)
        private_file(usage_log)
    elif any(p.exists() or p.is_symlink() for p in (ledger, usage_log, manifest)):
        # Bootstrap cannot conceal a partial/mutated state migration.
        if not all(p.is_file() for p in (ledger, usage_log, manifest)):
            raise StateError("INCOMPLETE_STAGING_STATE")
        verify_history(ledger, manifest)
        private_file(usage_log)
    real_enabled = bool(requested and settings.real_ai_enabled and not bootstrap)
    if requested and not real_enabled:
        raise StateError("EXPLICIT_AI_ENABLE_REQUIRED")
    if real_enabled:
        persistent_path(settings.live_ai_approval_path, state)
        private_file(settings.live_ai_approval_path)
        # A copied/renewed approval alone is insufficient for the cumulative
        # multi-user staging budget: a private reviewed policy must be present.
        policy = getattr(settings, "ai_budget_policy_path", None)
        if policy is None:
            raise StateError("CUMULATIVE_BUDGET_POLICY_REQUIRED")
        private_file(persistent_path(policy, state))
    speech_path = settings.real_ai_speech_storage_path
    if speech_path is not None:
        persistent_path(speech_path, state)  # EncryptedSpeechCache uses a SQLite file.
    if (real_enabled and settings.real_ai_speech_enabled
            and (speech_path is None or not settings.real_ai_speech_encryption_key)):
        raise StateError("DURABLE_SPEECH_KEY_REQUIRED")
    updates = {
        "cors_origins": origins, "conversation_mode": "disabled",
        "story_generation_mode": "disabled", "ai_provider_mode": "disabled",
        "real_ai_enabled": real_enabled, "ai_usage_ledger_path": ledger,
        "real_ai_usage_log_path": usage_log,
    }
    settings = settings.model_copy(update=updates)
    return settings, {"state": state, "origin": origin, "tls_mode": tls_mode,
                      "bootstrap": bootstrap, "manifest": manifest}


class SecurityHeaders:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        async def safe_send(message):
            if message["type"] == "http.response.start":
                message = {**message, "headers": list(message.get("headers", [])) + [
                    (b"strict-transport-security", b"max-age=31536000"),
                    (b"x-content-type-options", b"nosniff"),
                    (b"referrer-policy", b"no-referrer"),
                    (b"x-frame-options", b"DENY"),
                ]}
            await send(message)
        await self.app(scope, receive, safe_send)


def staging_app(settings, options):
    from app.main import create_app
    from starlette.middleware.trustedhost import TrustedHostMiddleware

    app = create_app(settings)
    if settings.real_ai_enabled and not app.state.real_ai.capabilities()["enabled"]:
        raise StateError("LIVE_APPROVAL_OR_PROVIDER_UNAVAILABLE")
    app.add_middleware(SecurityHeaders)
    app.add_middleware(TrustedHostMiddleware,
                       allowed_hosts=[urlsplit(options["origin"]).hostname], www_redirect=False)
    # Keep interactive/private route documentation out of the public staging UI.
    app.openapi_url = None
    app.routes[:] = [route for route in app.routes
                     if getattr(route, "path", None) not in {"/docs", "/docs/oauth2-redirect", "/redoc", "/openapi.json"}]
    return app


def prune_backups(directory: Path, keep: int):
    """Delete only complete managed snapshot copies, never live state/user data."""
    from scripts.staging_state import verify_backup

    if not 2 <= keep <= 168:
        raise StateError("INVALID_BACKUP_RETENTION")
    managed = []
    expected = {"ledger.sqlite3", "usage.jsonl", "history.json", "snapshot.json"}
    for child in directory.iterdir():
        if not re.fullmatch(r"\d{8}T\d{12}Z", child.name) or child.is_symlink():
            continue
        private_directory(child)
        if {p.name for p in child.iterdir()} != expected:
            continue
        verify_backup(child)
        managed.append(child)
    for child in sorted(managed)[:-keep]:
        for name in expected:
            private_file(child / name)
        for name in expected:
            (child / name).unlink()
        child.rmdir()


def backup_once(settings, options):
    state = options["state"]
    directory = state / "backups"
    if not directory.exists():
        private_directory(directory, create=True)
    else:
        private_directory(directory)
    verify_history(settings.ai_usage_ledger_path, options["manifest"])
    label = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    result = create_backup(settings.ai_usage_ledger_path, settings.real_ai_usage_log_path, directory / label)
    prune_backups(directory, options.get("backup_keep", 24))
    print(json.dumps({"event": "staging_backup", "ok": bool(result["backup_created"])}), flush=True)


def backup_loop(settings, options, stop, interval):
    while not stop.wait(interval):
        try:
            backup_once(settings, options)
        except (OSError, ValueError, sqlite3.Error, TypeError, KeyError):
            print('{"event":"staging_backup","ok":false}', file=sys.stderr, flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Private/local preflight only; no HTTP or paid calls.")
    args = parser.parse_args(argv)
    previous_umask = os.umask(0o077)
    try:
        settings, options = staging_configuration()
        app = staging_app(settings, options)
        port = int(os.environ.get("PORT", "10000"))
        if not 1024 <= port <= 65535:
            raise StateError("UNPRIVILEGED_PORT_REQUIRED")
        interval = int(os.environ.get("STAGING_BACKUP_INTERVAL_SECONDS", "3600"))
        if not 300 <= interval <= 86400:
            raise StateError("INVALID_BACKUP_INTERVAL")
        options["backup_keep"] = int(os.environ.get("STAGING_BACKUP_KEEP", "24"))
        if not 2 <= options["backup_keep"] <= 168:
            raise StateError("INVALID_BACKUP_RETENTION")
        tls = {}
        if options["tls_mode"] == "direct":
            certificate = Path(os.environ.get("STAGING_TLS_CERT_FILE", ""))
            key = Path(os.environ.get("STAGING_TLS_KEY_FILE", ""))
            private_file(certificate)
            private_file(key)
            tls = {"ssl_certfile": str(certificate), "ssl_keyfile": str(key)}
        if args.check:
            print(json.dumps({"staging_preflight": "ok", "https_ingress": options["tls_mode"],
                              "history_required": not options["bootstrap"],
                              "bootstrap_ai_off": options["bootstrap"],
                              "real_ai_enabled": settings.real_ai_enabled, "workers": 1}))
            return 0
        if not options["bootstrap"]:
            backup_once(settings, options)
        stop = threading.Event()
        thread = None
        if not options["bootstrap"]:
            thread = threading.Thread(target=backup_loop, args=(settings, options, stop, interval), daemon=True)
            thread.start()
        try:
            import uvicorn
            uvicorn.run(app, host="0.0.0.0", port=port, workers=1, access_log=False,
                        proxy_headers=False, forwarded_allow_ips="", server_header=False,
                        limit_concurrency=32, timeout_keep_alive=5, **tls)
        finally:
            stop.set()
            if thread:
                thread.join(timeout=10)
        return 0
    except Exception:
        # Startup/provider/cache constructors may raise structured API errors.
        # Never echo their exception text or private paths into host logs.
        print('{"staging_preflight":"failed","code":"STAGING_NOT_READY"}', file=sys.stderr)
        return 2
    finally:
        os.umask(previous_umask)


if __name__ == "__main__":
    raise SystemExit(main())
