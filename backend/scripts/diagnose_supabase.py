"""Safely diagnose the dedicated development Supabase public API connection.

The diagnostic is deliberately read-only.  It sends only a project publishable
key, only to the pinned development project, and never prints credentials or
untrusted upstream response text.
"""

from __future__ import annotations

import hashlib
import os
import re
import sys
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import IO, Any

import httpx

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import Settings  # noqa: E402


DEV_SUPABASE_REF = "edbkuunyeyxnyenmmqud"
DEV_SUPABASE_URL = f"https://{DEV_SUPABASE_REF}.supabase.co"
PROFILE_PATH = "/rest/v1/profiles"
PROFILE_PARAMS = {"select": "id", "limit": "0"}
KNOWN_SAFE_POSTGREST_CODES = {"42501", "PGRST301", "PGRST302"}
CONFIG_ENV_NAMES = (
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
)
IGNORED_EXPO_NAMES = (
    "EXPO_PUBLIC_SUPABASE_URL",
    "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
)
_PUBLISHABLE_KEY = re.compile(r"sb_publishable_[A-Za-z0-9_-]{20,}\Z")
_PLACEHOLDER_MARKERS = ("<", ">", "placeholder", "replace", "your-key", "your_key")


def _write(output: IO[str], name: str, value: object) -> None:
    output.write(f"{name}={value}\n")


def _fingerprint(key: str) -> str:
    """Return a comparison-safe, intentionally truncated SHA-256 fingerprint."""

    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:12]


def _environment_hints(output: IO[str], environment: Mapping[str, str]) -> None:
    configured = [name for name in CONFIG_ENV_NAMES if name in environment]
    ignored = [name for name in IGNORED_EXPO_NAMES if name in environment]
    _write(output, "process_environment_names", ",".join(configured) or "none")
    if configured:
        _write(output, "precedence_hint", "process_environment_overrides_dotenv")
    if ignored:
        _write(output, "ignored_backend_environment_names", ",".join(ignored))


def _safe_response_code(response: httpx.Response) -> str | None:
    try:
        payload = response.json()
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    code = payload.get("code")
    if isinstance(code, str) and code in KNOWN_SAFE_POSTGREST_CODES:
        return code
    # Classify only known literal messages; never echo arbitrary upstream text
    # or assume that every 401 proves the application key itself is invalid.
    if payload.get("message") in ("Invalid API key", "Invalid API key."):
        return "INVALID_API_KEY"
    if payload.get("message") == "No API key found in request":
        return "API_KEY_MISSING"
    return None


def _client(
    factory: Callable[..., Any], *, timeout: float
) -> Any:
    return factory(timeout=timeout, follow_redirects=False)


def run_diagnostic(
    *,
    settings_factory: Callable[[], Any] = Settings,
    client_factory: Callable[..., Any] = httpx.Client,
    environment: Mapping[str, str] | None = None,
    output: IO[str] | None = None,
) -> int:
    """Run a secret-safe, zero-row readiness diagnostic.

    Return 0 for a successful 2xx probe, 1 for a network/upstream rejection, and
    2 when local configuration is unsafe or incomplete.
    """

    destination = output if output is not None else sys.stdout
    current_environment = environment if environment is not None else os.environ
    _write(destination, "expected_project_ref", DEV_SUPABASE_REF)
    _environment_hints(destination, current_environment)

    try:
        settings = settings_factory()
    except Exception:
        _write(destination, "result", "INVALID_CONFIGURATION")
        return 2

    configured_url = str(getattr(settings, "supabase_url", "") or "").rstrip("/")
    if configured_url != DEV_SUPABASE_URL:
        _write(destination, "configured_project", "unexpected_or_missing")
        _write(destination, "result", "WRONG_DEVELOPMENT_PROJECT")
        return 2
    _write(destination, "configured_project", DEV_SUPABASE_REF)

    secret = getattr(settings, "supabase_publishable_key", None)
    try:
        raw_key = secret.get_secret_value() if secret is not None else ""
    except Exception:
        raw_key = ""
    if not isinstance(raw_key, str):
        _write(destination, "result", "VALID_PUBLISHABLE_KEY_REQUIRED")
        return 2
    clean_key = raw_key.strip()
    _write(destination, "key_outer_whitespace", str(raw_key != clean_key).lower())
    if clean_key:
        try:
            fingerprint = _fingerprint(clean_key)
        except UnicodeError:
            _write(destination, "result", "VALID_PUBLISHABLE_KEY_REQUIRED")
            return 2
        _write(destination, "key_sha256_12", fingerprint)

    lowered = clean_key.casefold()
    if clean_key.startswith("sb_secret_"):
        _write(destination, "key_kind", "secret_refused")
        _write(destination, "result", "PUBLISHABLE_KEY_REQUIRED")
        return 2
    if clean_key.startswith("eyJ"):
        _write(destination, "key_kind", "legacy_jwt_refused")
        _write(destination, "result", "PUBLISHABLE_KEY_REQUIRED")
        return 2
    if (
        not _PUBLISHABLE_KEY.fullmatch(clean_key)
        or any(marker in lowered for marker in _PLACEHOLDER_MARKERS)
    ):
        _write(destination, "key_kind", "missing_placeholder_or_unrecognized")
        _write(destination, "result", "VALID_PUBLISHABLE_KEY_REQUIRED")
        return 2
    _write(destination, "key_kind", "sb_publishable")

    headers = {"apikey": raw_key}
    try:
        with _client(
            client_factory, timeout=float(settings.request_timeout_seconds)
        ) as client:
            response = client.head(
                f"{DEV_SUPABASE_URL}{PROFILE_PATH}",
                params=PROFILE_PARAMS,
                headers=headers,
            )
            _write(destination, "head_status", response.status_code)
            if 200 <= response.status_code < 300:
                _write(destination, "result", "OK")
                return 0
            if 300 <= response.status_code < 400:
                _write(destination, "result", "REDIRECT_REFUSED")
                return 1
            if response.status_code == 401:
                classification = client.get(
                    f"{DEV_SUPABASE_URL}{PROFILE_PATH}",
                    params=PROFILE_PARAMS,
                    headers=headers,
                )
                _write(destination, "classification_status", classification.status_code)
                if 300 <= classification.status_code < 400:
                    _write(destination, "result", "REDIRECT_REFUSED")
                    return 1
                if 200 <= classification.status_code < 300:
                    _write(destination, "result", "HEAD_REJECTED_GET_OK")
                    return 1
                if classification.status_code not in (401, 403):
                    _write(destination, "result", "UPSTREAM_FAILED")
                    return 1
                safe_code = _safe_response_code(classification)
                _write(
                    destination,
                    "result",
                    safe_code if safe_code is not None else "AUTH_REJECTED",
                )
                return 1
            _write(destination, "result", "UPSTREAM_FAILED")
            return 1
    except Exception:
        # Diagnostic failures stay fixed and secret-free even when an injected
        # transport or an unexpected HTTP stack error includes request details.
        _write(destination, "result", "NETWORK_OR_REQUEST_FAILED")
        return 1


def main() -> int:
    return run_diagnostic()


if __name__ == "__main__":
    raise SystemExit(main())
