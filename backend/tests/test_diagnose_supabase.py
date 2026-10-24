"""Offline safety and behavior tests for the Supabase diagnostic helper."""

from __future__ import annotations

import hashlib
from io import StringIO

import httpx
import pytest

from app.core.config import Settings
from scripts import diagnose_supabase as diagnostic


PUBLISHABLE_KEY = "sb_publishable_" + "a" * 31
SECOND_PUBLISHABLE_KEY = "sb_publishable_" + "b" * 31


def configured_settings(key: str = PUBLISHABLE_KEY) -> Settings:
    return Settings(
        _env_file=None,
        supabase_url=diagnostic.DEV_SUPABASE_URL,
        supabase_publishable_key=key,
        request_timeout_seconds=2,
    )


def client_factory(handler, captured=None):
    def create(**kwargs):
        if captured is not None:
            captured.update(kwargs)
        return httpx.Client(transport=httpx.MockTransport(handler), **kwargs)

    return create


def run(*, settings_factory, handler, environment=None, captured=None):
    output = StringIO()
    result = diagnostic.run_diagnostic(
        settings_factory=settings_factory,
        client_factory=client_factory(handler, captured),
        environment={} if environment is None else environment,
        output=output,
    )
    return result, output.getvalue()


def test_success_uses_exact_read_only_probe_and_prints_only_fingerprint():
    requests = []
    client_options = {}

    def handler(request):
        requests.append(request)
        assert request.method == "HEAD"
        assert request.url == httpx.URL(
            f"{diagnostic.DEV_SUPABASE_URL}/rest/v1/profiles",
            params={"select": "id", "limit": "0"},
        )
        assert request.headers["apikey"] == PUBLISHABLE_KEY
        return httpx.Response(200)

    result, output = run(
        settings_factory=configured_settings,
        handler=handler,
        captured=client_options,
    )

    assert result == 0
    assert len(requests) == 1
    assert client_options == {"timeout": 2.0, "follow_redirects": False}
    assert f"key_sha256_12={hashlib.sha256(PUBLISHABLE_KEY.encode()).hexdigest()[:12]}" in output
    assert PUBLISHABLE_KEY not in output
    assert "key_kind=sb_publishable" in output
    assert "result=OK" in output


def test_process_environment_alias_overrides_dotenv_and_names_are_safe(monkeypatch, tmp_path):
    dotenv = tmp_path / "backend.env"
    dotenv.write_text(
        f"SUPABASE_URL={diagnostic.DEV_SUPABASE_URL}\n"
        f"SUPABASE_PUBLISHABLE_KEY={PUBLISHABLE_KEY}\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("VITE_SUPABASE_URL", diagnostic.DEV_SUPABASE_URL)
    monkeypatch.setenv("VITE_SUPABASE_PUBLISHABLE_KEY", SECOND_PUBLISHABLE_KEY)

    def handler(request):
        assert request.headers["apikey"] == SECOND_PUBLISHABLE_KEY
        return httpx.Response(204)

    result, output = run(
        settings_factory=lambda: Settings(_env_file=dotenv),
        handler=handler,
        environment={
            "VITE_SUPABASE_URL": diagnostic.DEV_SUPABASE_URL,
            "VITE_SUPABASE_PUBLISHABLE_KEY": SECOND_PUBLISHABLE_KEY,
            "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "must-not-be-read",
        },
    )

    assert result == 0
    assert "process_environment_names=VITE_SUPABASE_URL,VITE_SUPABASE_PUBLISHABLE_KEY" in output
    assert "precedence_hint=process_environment_overrides_dotenv" in output
    assert "ignored_backend_environment_names=EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY" in output
    assert SECOND_PUBLISHABLE_KEY not in output
    assert "must-not-be-read" not in output


@pytest.mark.parametrize(
    ("key", "kind"),
    [
        ("", "missing_placeholder_or_unrecognized"),
        ("sb_publishable_<development-key>", "missing_placeholder_or_unrecognized"),
        ("sb_secret_do-not-transmit-this-value", "secret_refused"),
        ("eyJdo-not-transmit-this-legacy-jwt", "legacy_jwt_refused"),
    ],
)
def test_unsafe_or_placeholder_credentials_are_refused_without_http(key, kind):
    def fail_client(**kwargs):
        raise AssertionError("HTTP client must not be created")

    output = StringIO()
    result = diagnostic.run_diagnostic(
        settings_factory=lambda: configured_settings(key),
        client_factory=fail_client,
        environment={},
        output=output,
    )

    text = output.getvalue()
    assert result == 2
    assert f"key_kind={kind}" in text
    assert key not in text or not key
    assert "do-not-transmit" not in text


def test_malformed_unicode_configuration_fails_without_a_traceback_or_http():
    output = StringIO()
    result = diagnostic.run_diagnostic(
        settings_factory=lambda: configured_settings("sb_publishable_\ud800"),
        client_factory=lambda **kwargs: pytest.fail("Invalid key must not be transmitted"),
        environment={}, output=output,
    )
    assert result == 2 and "result=VALID_PUBLISHABLE_KEY_REQUIRED" in output.getvalue()


def test_wrong_project_is_refused_before_key_is_read_or_transmitted():
    class UnreadableSecret:
        def get_secret_value(self):
            raise AssertionError("key must not be read for an unpinned project")

    class WrongSettings:
        supabase_url = "https://wrong-project.supabase.co"
        supabase_publishable_key = UnreadableSecret()
        request_timeout_seconds = 2

    output = StringIO()
    result = diagnostic.run_diagnostic(
        settings_factory=WrongSettings,
        client_factory=lambda **kwargs: (_ for _ in ()).throw(
            AssertionError("HTTP client must not be created")
        ),
        environment={},
        output=output,
    )

    assert result == 2
    assert "result=WRONG_DEVELOPMENT_PROJECT" in output.getvalue()


def test_outer_whitespace_is_reported_and_same_configured_header_is_used():
    raw_key = f" {PUBLISHABLE_KEY} "

    def handler(request):
        assert request.headers["apikey"] == raw_key
        return httpx.Response(200)

    result, output = run(
        settings_factory=lambda: configured_settings(raw_key),
        handler=handler,
    )

    assert result == 0
    assert "key_outer_whitespace=true" in output
    assert raw_key not in output


def test_401_uses_only_read_only_get_without_inventing_an_invalid_key_cause():
    methods = []
    private_body = {"message": "private arbitrary upstream text", "token": PUBLISHABLE_KEY}

    def handler(request):
        methods.append(request.method)
        assert dict(request.url.params) == {"select": "id", "limit": "0"}
        assert request.headers["apikey"] == PUBLISHABLE_KEY
        return httpx.Response(401, json=private_body)

    result, output = run(settings_factory=configured_settings, handler=handler)

    assert result == 1
    assert methods == ["HEAD", "GET"]
    assert "result=AUTH_REJECTED" in output
    assert "private arbitrary" not in output
    assert PUBLISHABLE_KEY not in output


@pytest.mark.parametrize("message,expected", [
    ("Invalid API key", "INVALID_API_KEY"),
    ("No API key found in request", "API_KEY_MISSING"),
])
def test_only_literal_known_gateway_errors_get_specific_classification(message, expected):
    result, output = run(settings_factory=configured_settings,
                         handler=lambda request: httpx.Response(401, json={"message": message}))
    assert result == 1 and f"result={expected}" in output


@pytest.mark.parametrize("get_status,expected", [(200, "HEAD_REJECTED_GET_OK"), (503, "UPSTREAM_FAILED")])
def test_get_result_does_not_misdiagnose_a_head_or_dependency_failure(get_status, expected):
    def handler(request):
        return httpx.Response(401 if request.method == "HEAD" else get_status, json=[])

    result, output = run(settings_factory=configured_settings, handler=handler)
    assert result == 1 and f"result={expected}" in output
    assert "result=INVALID_API_KEY" not in output


@pytest.mark.parametrize("safe_code", sorted(diagnostic.KNOWN_SAFE_POSTGREST_CODES))
def test_401_classification_prints_only_allowlisted_postgrest_code(safe_code):
    def handler(request):
        if request.method == "HEAD":
            return httpx.Response(401, text="never print this")
        return httpx.Response(
            403,
            json={"code": safe_code, "message": "private database detail"},
        )

    result, output = run(settings_factory=configured_settings, handler=handler)

    assert result == 1
    assert f"result={safe_code}" in output
    assert "private database detail" not in output
    assert "never print this" not in output


def test_redirect_is_not_followed_or_reported_with_location():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(
            302,
            headers={"location": "https://attacker.example/?secret=private"},
        )

    result, output = run(settings_factory=configured_settings, handler=handler)

    assert result == 1
    assert [request.method for request in requests] == ["HEAD"]
    assert "result=REDIRECT_REFUSED" in output
    assert "attacker" not in output
    assert "private" not in output


def test_network_exception_text_is_not_exposed():
    def handler(request):
        raise httpx.ConnectError(
            f"private failure containing {PUBLISHABLE_KEY}", request=request
        )

    result, output = run(settings_factory=configured_settings, handler=handler)

    assert result == 1
    assert "result=NETWORK_OR_REQUEST_FAILED" in output
    assert "private failure" not in output
    assert PUBLISHABLE_KEY not in output
