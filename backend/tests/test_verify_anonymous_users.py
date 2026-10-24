"""Offline safety tests for the temporary anonymous-user acceptance helper."""

import io
import json
import os
import subprocess
from types import SimpleNamespace
from uuid import UUID

import httpx
from pydantic import SecretStr

import scripts.verify_anonymous_users as verifier


PUBLIC_KEY = "synthetic-public-key"
TOKEN_A = "synthetic-anonymous-token-a"
TOKEN_B = "synthetic-anonymous-token-b"
USER_A = UUID("11111111-1111-4111-8111-111111111111")
USER_B = UUID("22222222-2222-4222-8222-222222222222")
MARKER = "memy-anonymous-acceptance-20261018T120000Z-abcdef1234567890"


def configured_settings(url=verifier.DEV_SUPABASE_URL):
    return SimpleNamespace(
        supabase_configured=True,
        supabase_url=url,
        supabase_publishable_key=SecretStr(PUBLIC_KEY),
        request_timeout_seconds=5,
    )


class AnonymousAuth:
    def __init__(self, *, second_signup_status=200, anonymous=True, same_user=False):
        self.second_signup_status = second_signup_status
        self.anonymous = anonymous
        self.same_user = same_user
        self.signup_count = 0
        self.requests = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert request.headers["apikey"] == PUBLIC_KEY
        if request.url.path == "/auth/v1/signup":
            self.signup_count += 1
            assert request.method == "POST"
            assert request.headers["authorization"] == f"Bearer {PUBLIC_KEY}"
            assert request.headers["x-supabase-api-version"] == "2024-01-01"
            label = "A" if self.signup_count == 1 else "B"
            assert json.loads(request.content) == {
                "data": {
                    verifier.RUN_METADATA_KEY: MARKER,
                    verifier.LABEL_METADATA_KEY: label,
                },
                "gotrue_meta_security": {},
            }
            if self.signup_count == 2 and self.second_signup_status != 200:
                return httpx.Response(
                    self.second_signup_status,
                    json={"message": f"private failure {TOKEN_A} {PUBLIC_KEY}"},
                )
            user_id = USER_A if self.signup_count == 1 or self.same_user else USER_B
            token = TOKEN_A if self.signup_count == 1 else TOKEN_B
            return httpx.Response(
                200,
                json={"access_token": token, "user": {"id": str(user_id)}},
            )
        if request.url.path == "/auth/v1/user":
            token = request.headers["authorization"].removeprefix("Bearer ")
            label = "A" if token == TOKEN_A else "B"
            user_id = USER_A if label == "A" or self.same_user else USER_B
            return httpx.Response(
                200,
                json={
                    "id": str(user_id),
                    "is_anonymous": self.anonymous,
                    "user_metadata": {
                        verifier.RUN_METADATA_KEY: MARKER,
                        verifier.LABEL_METADATA_KEY: label,
                    },
                },
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")


def client_factory(handler):
    return lambda **kwargs: httpx.Client(transport=httpx.MockTransport(handler), **kwargs)


def enabled_environment():
    return {verifier.OPT_IN_VARIABLE: "1", "SAFE_PARENT_VALUE": "kept"}


def assert_safe_output(value: str):
    for secret in (PUBLIC_KEY, TOKEN_A, TOKEN_B, "eyJabcdefgh.ijklmnop.qrstuvwx"):
        assert secret not in value
    allowed = ("Run marker: ", "Anonymous user ", "Result: ", "Cleanup required: ")
    assert all(line.startswith(allowed) for line in value.splitlines())


def test_explicit_gate_refuses_before_config_or_network():
    calls = []
    output = io.StringIO()
    result = verifier.run_anonymous_verification(
        environ={},
        stdout=output,
        settings_factory=lambda: calls.append("settings"),
        client_factory=lambda **_kwargs: calls.append("client"),
        process_runner=lambda *_args, **_kwargs: calls.append("process"),
    )
    assert result == 2
    assert calls == []
    assert output.getvalue() == (
        f"Result: not run; set {verifier.OPT_IN_VARIABLE}=1 for explicit opt-in.\n"
    )


def test_wrong_project_is_refused_before_marker_or_network():
    calls = []
    output = io.StringIO()
    result = verifier.run_anonymous_verification(
        environ=enabled_environment(),
        stdout=output,
        settings_factory=lambda: configured_settings("https://example.invalid"),
        client_factory=lambda **_kwargs: calls.append("client"),
        process_runner=lambda *_args, **_kwargs: calls.append("process"),
    )
    assert result == 2
    assert calls == []
    assert "Run marker:" not in output.getvalue()
    assert "dedicated Memy AI development project" in output.getvalue()


def test_creates_two_verified_anonymous_users_and_runs_both_live_suites():
    auth = AnonymousAuth()
    output = io.StringIO()
    captured = {}

    def process_runner(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        environment = kwargs["env"]
        assert environment["MEMY_TEST_USER_A_TOKEN"] == TOKEN_A
        assert environment["MEMY_TEST_USER_B_TOKEN"] == TOKEN_B
        assert environment["RUN_MEMY_DAY2_INTEGRATION"] == "1"
        assert environment["RUN_MEMY_DAY3_INTEGRATION"] == "1"
        assert environment["PYTHONDONTWRITEBYTECODE"] == "1"
        assert environment["SAFE_PARENT_VALUE"] == "kept"
        assert verifier.OPT_IN_VARIABLE not in environment
        return subprocess.CompletedProcess(
            command,
            0,
            f"3 passed; never print {TOKEN_A}\n",
            f"jwt=eyJabcdefgh.ijklmnop.qrstuvwx key={PUBLIC_KEY}\n",
        )

    result = verifier.run_anonymous_verification(
        environ=enabled_environment(),
        stdout=output,
        settings_factory=configured_settings,
        client_factory=client_factory(auth),
        process_runner=process_runner,
        marker_factory=lambda: MARKER,
    )

    assert result == 0
    assert captured["command"][-2:] == [
        verifier.DAY2_LIVE_TEST_NODE,
        verifier.DAY3_LIVE_TEST_FILE,
    ]
    assert captured["kwargs"]["cwd"] == verifier.BACKEND_DIR
    assert captured["kwargs"]["capture_output"] is True
    assert captured["kwargs"]["text"] is True
    assert captured["kwargs"]["check"] is False
    assert output.getvalue().splitlines() == [
        f"Run marker: {MARKER}",
        f"Anonymous user A UID: {USER_A}",
        f"Anonymous user B UID: {USER_B}",
        "Result: Day 2 and Day 3 acceptance tests passed.",
        "Cleanup required: manually delete the exact anonymous Auth user IDs listed above "
        "(matching this run marker) in the Supabase dashboard.",
    ]
    assert_safe_output(output.getvalue())


def test_partial_second_signup_failure_reports_first_cleanup_id_only():
    auth = AnonymousAuth(second_signup_status=429)
    output = io.StringIO()
    result = verifier.run_anonymous_verification(
        environ=enabled_environment(),
        stdout=output,
        settings_factory=configured_settings,
        client_factory=client_factory(auth),
        process_runner=lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("pytest must not run")
        ),
        marker_factory=lambda: MARKER,
    )
    assert result == 2
    assert f"Anonymous user A UID: {USER_A}" in output.getvalue()
    assert "Anonymous user B UID:" not in output.getvalue()
    assert "Cleanup required" in output.getvalue()
    assert "private failure" not in output.getvalue()
    assert_safe_output(output.getvalue())


def test_non_anonymous_get_user_is_rejected_and_cleanup_id_is_reported():
    auth = AnonymousAuth(anonymous=False)
    output = io.StringIO()
    result = verifier.run_anonymous_verification(
        environ=enabled_environment(),
        stdout=output,
        settings_factory=configured_settings,
        client_factory=client_factory(auth),
        process_runner=lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("pytest must not run")
        ),
        marker_factory=lambda: MARKER,
    )
    assert result == 2
    assert f"Anonymous user A UID: {USER_A}" in output.getvalue()
    assert "expected anonymous identity" in output.getvalue()
    assert "Cleanup required" in output.getvalue()
    assert_safe_output(output.getvalue())


def test_duplicate_verified_identity_is_rejected_before_pytest():
    auth = AnonymousAuth(same_user=True)
    output = io.StringIO()
    result = verifier.run_anonymous_verification(
        environ=enabled_environment(),
        stdout=output,
        settings_factory=configured_settings,
        client_factory=client_factory(auth),
        process_runner=lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("pytest must not run")
        ),
        marker_factory=lambda: MARKER,
    )
    assert result == 2
    assert "same identity twice" in output.getvalue()
    assert output.getvalue().count(str(USER_A)) == 2
    assert_safe_output(output.getvalue())


def test_child_failure_and_timeout_never_emit_captured_output():
    for runner, expected_code, expected_summary in (
        (
            lambda command, **_kwargs: subprocess.CompletedProcess(
                command, 1, f"token={TOKEN_A}", f"key={PUBLIC_KEY}"
            ),
            1,
            "acceptance tests failed (exit 1)",
        ),
        (
            lambda command, **kwargs: (_ for _ in ()).throw(
                subprocess.TimeoutExpired(
                    command,
                    kwargs["timeout"],
                    output=f"token={TOKEN_B}",
                    stderr=f"key={PUBLIC_KEY}",
                )
            ),
            124,
            "timed out and were stopped",
        ),
    ):
        output = io.StringIO()
        result = verifier.run_anonymous_verification(
            environ=enabled_environment(),
            stdout=output,
            settings_factory=configured_settings,
            client_factory=client_factory(AnonymousAuth()),
            process_runner=runner,
            marker_factory=lambda: MARKER,
        )
        assert result == expected_code
        assert expected_summary in output.getvalue()
        assert_safe_output(output.getvalue())


def test_unsafe_marker_is_rejected_before_network():
    calls = []
    output = io.StringIO()
    result = verifier.run_anonymous_verification(
        environ=enabled_environment(),
        stdout=output,
        settings_factory=configured_settings,
        client_factory=lambda **_kwargs: calls.append("network"),
        process_runner=lambda *_args, **_kwargs: calls.append("pytest"),
        marker_factory=lambda: "memy-anonymous-acceptance-safe\ninjected",
    )
    assert result == 2
    assert calls == []
    assert "Run marker:" not in output.getvalue()
    assert "safe anonymous-acceptance run marker" in output.getvalue()
